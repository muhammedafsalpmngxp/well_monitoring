using System.Net.Mail;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Watched answers. A check runs the answer's stored query again (no AI call): a dataset answer's spec, or an Ask Data
/// answer's checked SQL, run like an export. It evaluates it with AlertCheck and notifies the owner in the app (the bell
/// opens the alert) and the alert's e-mail addresses, if any, when the alert starts firing; while it keeps firing nobody is notified again. Scheduled checks run as the owner, so they see only data the owner may see.
/// </summary>
public sealed class AiAlertService(
    IAiAlertRepository alerts,
    IAiConversationRepository conversations,
    IAiAskService ask,
    IRecipientResolver directory,
    IControlPlaneNotificationClient notifications,
    IMailSender mail,
    IAiService ai,
    IAiPromptStore prompts,
    IAiKnowledgeRepository knowledge,
    AiAlertOptions options,
    ILogger<AiAlertService> log) : IAiAlertService
{
    // Column and notification sizes, not settings: core.AiAlerts.last_message and the bell's title.
    private const int MessageLength = 1000;
    private const int TitleLength = 200;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<AiAlertDto>> ListAsync(long tenantId, long userId, CancellationToken ct) =>
        (await alerts.ListAsync(tenantId, userId.ToString(), ct)).Select(ToDto).ToList();

    public async Task<AiAlertDto?> CreateAsync(CreateAiAlertRequest request, long tenantId, long userId, CancellationToken ct)
    {
        await RequireFeatureAsync(tenantId, ct);
        var kind = (request.Kind ?? "").Trim().ToLowerInvariant();
        if (!AlertCheck.IsKind(kind)) throw new InvalidOperationException("Choose above, below, unusual or change.");
        if (kind != AlertCheck.Unusual && request.Threshold is null) throw new InvalidOperationException(kind == AlertCheck.Change ? "Enter the percent change allowed." : "Enter the limit to compare with.");
        if (kind == AlertCheck.Change && request.Threshold < 0) throw new InvalidOperationException("The percent change cannot be negative.");
        if (!options.EveryHours.Contains(request.EveryHours)) throw new InvalidOperationException("Choose one of the offered check intervals.");
        var emails = ParseEmails(request.NotifyEmails, options.MaxEmails);

        var msg = await conversations.GetMessageAsync(request.MessageId, ct);
        if (msg is not { Role: "assistant" }) return null;
        var conv = await conversations.GetAsync(msg.ConversationId, tenantId, userId.ToString(), ct);
        if (conv is null) return null;
        string query;
        (AiQuerySpec Spec, AiQueryResult Result)? ran = null;
        if (conv.SourceType == AiSources.AskData)
        {
            // An Ask Data answer is watched through its checked SQL; it runs now, so its shape is known before saving.
            var sql = await ask.AskDataSqlAsync(msg.Id, ct)
                ?? throw new InvalidOperationException("This answer has no query to watch (an answer's steps are kept 30 days).");
            ran = await ask.RunAskDataAsync(sql, tenantId, ct);
            query = AskDataSettingsRules.ExampleJson(sql);
        }
        else if (msg.QuerySpecJson is not null) query = msg.QuerySpecJson;
        else return null;
        var groups = ran?.Spec.GroupBy ?? JsonSerializer.Deserialize<AiQuerySpec>(query, Json)?.GroupBy;
        if (kind == AlertCheck.Change && groups is { Count: > 0 })
            throw new InvalidOperationException("Change watching needs a single-number answer; this answer has groups. Choose above, below or unusual.");
        var question = (await conversations.GetMessagesAsync(conv.Id, ct)).LastOrDefault(m => m.Role == "user" && m.Id < msg.Id)?.Content ?? conv.Title;

        var alert = new AiAlert
        {
            TenantId = tenantId, UserId = userId.ToString(), SourceType = conv.SourceType, SourceId = conv.SourceId, SourceName = conv.SourceName,
            Question = question, QuerySpecJson = query, Kind = kind, Threshold = kind == AlertCheck.Unusual ? null : request.Threshold,
            EveryHours = request.EveryHours, NotifyEmails = emails.Count == 0 ? null : string.Join(",", emails), NextCheckAt = DateTime.UtcNow,
        };
        alerts.Add(alert);
        // The first check sets the starting point; it does not notify.
        await CheckCoreAsync(alert, notify: false, ct, ran);
        return ToDto(alert);
    }

    public async Task<AiAlertDto?> CheckAsync(long id, long tenantId, long? userId, CancellationToken ct)
    {
        var alert = await alerts.GetAsync(id, tenantId, userId?.ToString(), ct);
        if (alert is null) return null;
        if (userId is not null)
        {
            await RequireFeatureAsync(tenantId, ct);
            await CheckCoreAsync(alert, notify: true, ct);
            return ToDto(alert);
        }

        // Scheduled: as the owner, only while AI is on and the owner still has the Alerts feature.
        var owner = long.TryParse(alert.UserId, out var ownerId)
            ? (await directory.ResolveAsync(tenantId, [ownerId], [], ct)).FirstOrDefault(u => u.UserId == ownerId) : null;
        using (owner is null ? null : RunAsScope.Begin(owner))
        {
            if (owner is not { IsActive: true }) await SkipAsync(alert, "Not checked: the owner is inactive or no longer has access to this tenant.", ct);
            else if (!await ask.FeatureOnAsync(tenantId, AiFeatureCatalog.Alerts, ct)) await SkipAsync(alert, "Not checked: AI or the Alerts feature is switched off for the owner.", ct);
            else await CheckCoreAsync(alert, notify: true, ct);
        }
        return ToDto(alert);
    }

    public async Task<bool> DeleteAsync(long id, long tenantId, long userId, CancellationToken ct)
    {
        var alert = await alerts.GetAsync(id, tenantId, userId.ToString(), ct);
        if (alert is null) return false;
        alerts.Remove(alert);
        await alerts.SaveAsync(ct);
        return true;
    }

    private async Task CheckCoreAsync(AiAlert alert, bool notify, CancellationToken ct, (AiQuerySpec Spec, AiQueryResult Result)? ran = null)
    {
        var now = DateTime.UtcNow;
        alert.LastCheckedAt = now;
        alert.NextCheckAt = now.AddHours(alert.EveryHours);
        var history = string.IsNullOrEmpty(alert.HistoryJson) ? [] : JsonSerializer.Deserialize<List<double>>(alert.HistoryJson) ?? [];
        AlertOutcome? outcome = null;
        string? error = null;
        try
        {
            var (spec, result) = ran ?? await RunAsync(alert, ct);
            outcome = AlertCheck.Evaluate(alert.Kind, alert.Threshold, spec, result, history, options);
        }
        // Any failure of the dataset or its database is reported on the alert, not thrown at the worker.
        catch (Exception ex) when (ex is not OperationCanceledException) { error = ex.Message; }

        if (outcome is null)
        {
            alert.LastMessage = Trim($"The check could not run: {error}", MessageLength);
            await alerts.SaveAsync(ct);
            return;
        }
        if (outcome.Value is { } v) alert.HistoryJson = JsonSerializer.Serialize(history.Append(v).TakeLast(options.MaxHistory));
        var started = outcome.Fired && !alert.IsTriggered;
        alert.IsTriggered = outcome.Fired;
        alert.LastMessage = Trim(outcome.Message, MessageLength);
        await alerts.SaveAsync(ct);
        if (!notify || !started) return;
        var notice = await WriteNoticeAsync(alert, history, ct);
        if (long.TryParse(alert.UserId, out var owner))
            await notifications.PublishAsync(alert.TenantId, "AiAlert", Trim($"Alert: {alert.Question}", TitleLength), Trim(notice, MessageLength), AlertRoute(alert.Id), [owner], null, ct);
        if (alert.NotifyEmails is not null) await MailAsync(alert, notice, ct);
    }

    /// <summary>Where the bell takes the owner: the app opens the Ask AI panel on this alert (no page of its own).</summary>
    internal static string AlertRoute(long id) => $"/ask-ai/alerts/{id}";

    /// <summary>Runs the watched query again: a dataset answer's spec, or an Ask Data answer's SQL (checked like an export).</summary>
    private async Task<(AiQuerySpec Spec, AiQueryResult Result)> RunAsync(AiAlert alert, CancellationToken ct)
    {
        if (alert.SourceType == AiSources.AskData)
            return await ask.RunAskDataAsync(AskDataSettingsRules.ExampleSql(alert.QuerySpecJson)
                ?? throw new InvalidOperationException("The watched query is missing."), alert.TenantId, ct);
        var spec = JsonSerializer.Deserialize<AiQuerySpec>(alert.QuerySpecJson, Json)!;
        return (spec, await ask.RunSpecAsync(alert.SourceType, alert.SourceId, alert.TenantId, spec, ct));
    }

    /// <summary>
    /// The notification text: the AI words it from the checked result using the "Alert message" instruction
    /// (tenant or dataset); the checked result is always appended. Falls back to the result alone.
    /// </summary>
    private async Task<string> WriteNoticeAsync(AiAlert alert, IReadOnlyList<double> history, CancellationToken ct)
    {
        var facts = alert.LastMessage ?? "";
        try
        {
            var texts = AiPrompts.Merge(await prompts.GetAsync(alert.TenantId, ct),
                await knowledge.GetDatasetPromptsAsync(alert.TenantId, alert.SourceType, alert.SourceId, ct));
            var rule = alert.Kind == AlertCheck.Unusual ? "looks unusual" : alert.Kind == AlertCheck.Change ? $"changes by more than {alert.Threshold}%" : $"goes {alert.Kind} {alert.Threshold}";
            var past = history.Count == 0 ? "" : $"\nEarlier checks (oldest first): {string.Join(", ", history.TakeLast(options.NoticeHistory).Select(Insights.N))}";
            var messages = new List<AiMessage>
            {
                new("system", AiPrompts.Text(AiPrompts.AlertMessage, texts) + " Reply with plain text only."),
                new("user", $"Question watched: {alert.Question}\nDataset: {alert.SourceName}\nRule: notify when the answer {rule}, checked every {alert.EveryHours} h\nResult now: {facts}{past}"),
            };
            var text = (await ai.CompleteAsync(alert.TenantId, alert.UserId, "alert", messages, ct)).Content.Trim();
            return text.Length == 0 ? facts : $"{text}\n\nChecked: {facts}";
        }
        // AI off, over quota or unreachable: the checked result is still a complete notice.
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "AI alert {Id}: notice not written by the AI", alert.Id);
            return facts;
        }
    }

    /// <summary>E-mails the alert's addresses; a mail failure is noted on the alert, never thrown at the worker.</summary>
    private async Task MailAsync(AiAlert alert, string notice, CancellationToken ct)
    {
        var to = ParseEmails(alert.NotifyEmails, int.MaxValue);   // checked when the alert was saved
        var body = $"{notice.Replace("\n", "\r\n")}\r\n\r\nQuestion: {alert.Question}\r\nDataset: {alert.SourceName}\r\n" +
                   $"Checked: {alert.LastCheckedAt:yyyy-MM-dd HH:mm} UTC\r\n\r\nOpen TWise > Ask AI > Alerts to see the history or stop watching.";
        try
        {
            var result = await mail.SendAsync(new MailEnvelope(to, [], [], Trim($"TWise alert: {alert.Question}", TitleLength), body, []), ct);
            if (result.Refused.Count > 0) alert.LastMessage = Trim($"{alert.LastMessage} (mail refused for {string.Join(", ", result.Refused)})", MessageLength);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "AI alert {Id}: mail not sent", alert.Id);
            alert.LastMessage = Trim($"{alert.LastMessage} (mail not sent: {ex.Message})", MessageLength);
        }
        await alerts.SaveAsync(ct);
    }

    /// <summary>Distinct valid addresses from a comma- or semicolon-separated list; throws on a bad one or more than <paramref name="max"/>.</summary>
    internal static List<string> ParseEmails(string? text, int max)
    {
        var list = new List<string>();
        foreach (var raw in (text ?? "").Split([',', ';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!MailAddress.TryCreate(raw, out var a) || a.Address != raw) throw new InvalidOperationException($"'{raw}' is not a valid e-mail address.");
            if (!list.Contains(raw, StringComparer.OrdinalIgnoreCase)) list.Add(raw);
        }
        if (list.Count > max) throw new InvalidOperationException($"At most {max} e-mail addresses.");
        return list;
    }

    private async Task SkipAsync(AiAlert alert, string message, CancellationToken ct)
    {
        alert.NextCheckAt = DateTime.UtcNow.AddHours(alert.EveryHours);
        alert.LastMessage = message;
        await alerts.SaveAsync(ct);
    }

    private async Task RequireFeatureAsync(long tenantId, CancellationToken ct)
    {
        if (!await ask.FeatureOnAsync(tenantId, AiFeatureCatalog.Alerts, ct))
            throw new InvalidOperationException("Alerts are not enabled for your role. An admin can grant them under Settings → AI Features.");
    }

    private static string Trim(string s, int max) => s.Length > max ? s[..max] : s;

    private static AiAlertDto ToDto(AiAlert a) => new(a.Id, a.SourceType, a.SourceId, a.SourceName, a.Question, a.Kind, a.Threshold, a.EveryHours, a.NotifyEmails,
        a.IsTriggered, a.LastMessage, AiDates.Utc(a.LastCheckedAt), AiDates.Utc(a.NextCheckAt));
}
