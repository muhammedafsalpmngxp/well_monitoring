using System.Collections.Concurrent;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// core.AiFeatureAnswer: an Agentic Feature's verified AI answers, kept per report date (the newest "keep" by last
/// use). Until infra/sql/add-ai-feature-answers.sql has been run the store does nothing and says so once; it looks
/// again every few minutes, so creating the table needs no restart.
/// </summary>
public sealed partial class AiFeatureAnswerStore(TenantDbContext db, ILogger<AiFeatureAnswerStore> logger) : IAiFeatureAnswerStore
{
    private static readonly TimeSpan LookAgain = TimeSpan.FromMinutes(5);
    private static long _missingSince;          // DateTime ticks (UTC) when the table was found missing; 0 = present

    public async Task<IReadOnlyList<KnownAnswerPayload>> RecentAsync(long tenantId, string feature, DateOnly reportDate, int take,
        CancellationToken ct)
    {
        if (take <= 0 || Missing()) return [];
        try
        {
            var rows = await db.AiFeatureAnswers.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.Feature == feature && a.ReportDate == reportDate)
                .OrderByDescending(a => a.UsedAt)
                .Take(take)
                .Select(a => new { a.AnswerKey, a.Draft, a.Verification, a.Model })
                .ToListAsync(ct);
            return rows.Select(r => new KnownAnswerPayload(r.AnswerKey.Trim(), r.Draft, Parse(r.Verification), r.Model)).ToList();
        }
        catch (Exception ex) when (IsMissingTable(ex))
        {
            MarkMissing();
            return [];
        }
    }

    public async Task<SavedAiAnswerDto?> LatestAsync(long tenantId, string feature, DateOnly reportDate, string kind, string? scope,
        CancellationToken ct)
    {
        if (Missing()) return null;
        try
        {
            return await db.AiFeatureAnswers.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.Feature == feature && a.ReportDate == reportDate && a.Kind == kind && a.Scope == scope)
                .OrderByDescending(a => a.UsedAt)
                .Select(a => new SavedAiAnswerDto(a.Draft, a.Model, a.CreatedAt, a.UsedAt))
                .FirstOrDefaultAsync(ct);
        }
        catch (Exception ex) when (IsMissingTable(ex))
        {
            MarkMissing();
            return null;
        }
    }

    public async Task SaveAsync(long tenantId, string feature, DateOnly reportDate, string kind, string? scope, string? user,
        JsonElement reply, int keep, CancellationToken ct)
    {
        if (keep <= 0 || Missing() || Answer(reply) is not { } answer) return;
        try
        {
            var now = DateTime.UtcNow;
            var row = await db.AiFeatureAnswers.FindAsync([tenantId, feature, answer.Key], ct);
            if (row is not null) row.UsedAt = now;
            else
            {
                db.AiFeatureAnswers.Add(new AiFeatureAnswer
                {
                    TenantId = tenantId, Feature = feature, AnswerKey = answer.Key, ReportDate = reportDate, Kind = kind,
                    Scope = scope, Draft = answer.Draft, Verification = answer.Verification?.GetRawText(),
                    Model = Clip(answer.Model, 100), CreatedBy = Clip(user ?? "system", 200), CreatedAt = now, UsedAt = now,
                });
            }
            await db.SaveChangesAsync(ct);

            // Only the date's newest answers are offered back; older ones would never be sent again.
            var stale = await db.AiFeatureAnswers
                .Where(a => a.TenantId == tenantId && a.Feature == feature && a.ReportDate == reportDate)
                .OrderByDescending(a => a.UsedAt)
                .Skip(keep)
                .ToListAsync(ct);
            if (stale.Count > 0)
            {
                db.AiFeatureAnswers.RemoveRange(stale);
                await db.SaveChangesAsync(ct);
            }
        }
        catch (Exception ex) when (IsMissingTable(ex))
        {
            MarkMissing();
        }
        catch (DbUpdateException)
        {
            // The same answer saved at the same moment by another request (or instance): it is there.
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>The reply's answer worth saving: verified, with a well-formed key and text; otherwise null.</summary>
    internal static KnownAnswerPayload? Answer(JsonElement reply)
    {
        if (reply.ValueKind != JsonValueKind.Object) return null;
        var key = Text(reply, "answer_key");
        var draft = Text(reply, "explanation");
        var verified = reply.TryGetProperty("verified", out var v) && v.ValueKind == JsonValueKind.True;
        if (!verified || key is null || !AnswerKey().IsMatch(key) || string.IsNullOrWhiteSpace(draft)) return null;
        JsonElement? verification = reply.TryGetProperty("verification", out var ver) && ver.ValueKind == JsonValueKind.Object
            ? ver.Clone() : null;
        return new KnownAnswerPayload(key, draft, verification, Text(reply, "model"));
    }

    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex AnswerKey();

    private static string? Text(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string? Clip(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    private static JsonElement? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonDocument.Parse(json).RootElement.Clone(); }
        catch (JsonException) { return null; }
    }

    private static bool Missing()
    {
        var since = Interlocked.Read(ref _missingSince);
        if (since == 0) return false;
        if (DateTime.UtcNow.Ticks - since < LookAgain.Ticks) return true;
        Interlocked.Exchange(ref _missingSince, 0);     // look again
        return false;
    }

    private void MarkMissing()
    {
        if (Interlocked.Exchange(ref _missingSince, DateTime.UtcNow.Ticks) == 0)
            logger.LogWarning("Agentic Features: the tenant database has no core.AiFeatureAnswer table yet, so AI answers are " +
                "kept only in the agent runtime's memory (lost when it restarts). Run smartops/infra/sql/add-ai-feature-answers.sql.");
    }

    private static bool IsMissingTable(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException)
            if (e is SqlException { Number: 208 }) return true;
        return false;
    }
}

/// <summary>
/// Daily Report's AI briefs and questions. Each request carries the report date's saved answers (core.AiFeatureAnswer):
/// the runtime reuses one only when it rests on exactly the same data, prompts, model and settings, so an unchanged day
/// is answered at once without an AI call, also after a restart. Every new verified answer is saved, and the AI calls
/// the runtime reports are logged against the tenant's quota.
/// </summary>
public sealed class DailyReportAgent(IAgenticFeatureContext context, IAgentRuntimeClient runtime, IAiUsageRepository usage,
    IAiFeatureAnswerStore answers, ILogger<DailyReportAgent> logger) : IDailyReportAgent
{
    private const string Feature = AgenticFeatureCatalog.DailyReport;

    public async Task<JsonElement> BriefAsync(long tenantId, string? userId, DailyBrief brief, CancellationToken ct)
    {
        var (envelope, keep, known) = await PrepareAsync(tenantId, brief.ReportDate, ct);
        var reply = await runtime.FeatureCallAsync(Feature, "agent/brief", envelope, BriefBody(brief, known), ct);
        await FinishAsync(tenantId, userId, brief.ReportDate, "brief", brief.Scope, reply, keep);
        return reply;
    }

    public async IAsyncEnumerable<AgentRuntimeEvent> BriefStreamAsync(long tenantId, string? userId, DailyBrief brief,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var (envelope, keep, known) = await PrepareAsync(tenantId, brief.ReportDate, ct);
        await foreach (var ev in runtime.FeatureStreamAsync(Feature, "agent/brief/stream", envelope, BriefBody(brief, known), ct))
        {
            if (ev.Type == "result") await FinishAsync(tenantId, userId, brief.ReportDate, "brief", brief.Scope, ev.Data, keep);
            yield return ev;
        }
    }

    public async Task<JsonElement> AskAsync(long tenantId, string? userId, DateOnly reportDate, string question, DateOnly today,
        CancellationToken ct)
    {
        var (envelope, keep, known) = await PrepareAsync(tenantId, reportDate, ct);
        var reply = await runtime.FeatureCallAsync(Feature, "agent/ask", envelope, new
        {
            reportDate = Day(reportDate), question, today = Day(today), knownAnswers = known,
        }, ct);
        await FinishAsync(tenantId, userId, reportDate, "ask", null, reply, keep);
        return reply;
    }

    private async Task<(AgenticFeatureEnvelope Envelope, int Keep, IReadOnlyList<KnownAnswerPayload> Known)> PrepareAsync(
        long tenantId, DateOnly reportDate, CancellationToken ct)
    {
        var envelope = await context.BuildAsync(tenantId, Feature, needsAi: true, ct);
        var keep = FeatureSetting.Int(envelope.Settings, "savedAnswersPerDate", 20);
        return (envelope, keep, await answers.RecentAsync(tenantId, Feature, reportDate, keep, ct));
    }

    private static object BriefBody(DailyBrief b, IReadOnlyList<KnownAnswerPayload> known) => new
    {
        reportDate = Day(b.ReportDate), scope = b.Scope, wellId = b.WellId, taskDailyId = b.TaskDailyId, today = Day(b.Today),
        knownAnswers = known,
    };

    /// <summary>Logs the usage and saves the answer even when the caller has gone (the work is done and paid for).</summary>
    private async Task FinishAsync(long tenantId, string? userId, DateOnly reportDate, string kind, string? scope, JsonElement reply,
        int keep)
    {
        await AgenticFeatureGateway.LogUsageAsync(usage, tenantId, userId, Feature, reply);
        try { await answers.SaveAsync(tenantId, Feature, reportDate, kind, scope, userId, reply, keep, CancellationToken.None); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Daily Report: a verified AI answer could not be saved; it is still kept in the agent runtime's memory.");
        }
    }

    internal static string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}

/// <summary>A feature setting from the envelope's resolved values (the seed default filled in), with a fallback.</summary>
internal static class FeatureSetting
{
    public static int Int(IReadOnlyDictionary<string, JsonElement> values, string key, int fallback) =>
        values.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : fallback;

    public static bool Bool(IReadOnlyDictionary<string, JsonElement> values, string key, bool fallback) =>
        values.TryGetValue(key, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : fallback;

    public static string Text(IReadOnlyDictionary<string, JsonElement> values, string key, string fallback) =>
        values.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())
            ? v.GetString()! : fallback;
}

/// <summary>
/// Keeps Daily Report's day brief ready: for every tenant with AI on and "Prepare the day brief in advance" ticked,
/// every "Check for new data every" minutes it asks for the day brief of today and the days before ("Report dates kept
/// ready"), today being the date in "Time zone of today". A brief whose data did not change comes back from the saved
/// answers without an AI call; a changed day is written again (one AI call) and saved, so the page shows it at once.
/// Up to AgenticFeatures:PrepareParallel (2) briefs are prepared at the same time. AgenticFeatures:PrepareBriefs false
/// turns the worker off on this instance; AgenticFeatures:PreparePollSeconds (60) is how often it looks.
/// </summary>
public sealed class DailyBriefWorker(IServiceScopeFactory scopes, IConfiguration config, ILogger<DailyBriefWorker> logger)
    : BackgroundService
{
    private readonly ConcurrentDictionary<long, DateTime> _lastRound = new();
    private readonly ConcurrentDictionary<string, bool> _toldOnce = new();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (bool.TryParse(config["AgenticFeatures:PrepareBriefs"], out var enabled) && !enabled) return;
        var poll = TimeSpan.FromSeconds(Setting("AgenticFeatures:PreparePollSeconds", 60, 15, 3600));
        var parallel = Setting("AgenticFeatures:PrepareParallel", 2, 1, 8);
        try { await Task.Delay(TimeSpan.FromSeconds(Setting("AgenticFeatures:PrepareStartDelaySeconds", 30, 0, 600)), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RoundAsync(parallel, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "Daily Report: preparing the day briefs failed; trying again later."); }
            try { await Task.Delay(poll, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RoundAsync(int parallel, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var work = new List<(long TenantId, DailyBrief Brief)>();
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TenantDbContext>();
            var seed = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.DailyReport);
            foreach (var s in await db.AiSettings.AsNoTracking().Where(s => s.IsEnabled).ToListAsync(ct))
            {
                var values = AgenticFeatureSettingsRules.Resolve(seed, AgenticFeatureSettingsRules.Stored(s, AgenticFeatureCatalog.DailyReport)).Values;
                if (!FeatureSetting.Bool(values, "prepareBriefs", true)) continue;
                var every = TimeSpan.FromMinutes(Math.Max(1, FeatureSetting.Int(values, "prepareEveryMinutes", 30)));
                if (_lastRound.TryGetValue(s.TenantId, out var last) && now - last < every) continue;
                _lastRound[s.TenantId] = now;
                var zone = FeatureSetting.Text(values, "prepareTimeZone", "UTC");
                var today = Today(zone, now, out var known);
                if (!known) TellOnce($"zone:{s.TenantId}:{zone}", $"Daily Report: the time zone \"{zone}\" (tenant {s.TenantId}) " +
                    "is not known on this server; today's date is taken in UTC. Correct it under AI Settings → Daily Report.");
                work.AddRange(DayBriefs(today, FeatureSetting.Int(values, "prepareDays", 2)).Select(b => (s.TenantId, b)));
            }
        }
        // The briefs are independent: up to `parallel` at the same time (each is SQL, then at most one AI call).
        await Parallel.ForEachAsync(work, new ParallelOptions { MaxDegreeOfParallelism = parallel, CancellationToken = ct },
            async (item, token) => await PrepareAsync(item.TenantId, item.Brief, token));
    }

    private async Task PrepareAsync(long tenantId, DailyBrief brief, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var agent = scope.ServiceProvider.GetRequiredService<IDailyReportAgent>();
        var day = DailyReportAgent.Day(brief.ReportDate);
        try
        {
            var reply = await agent.BriefAsync(tenantId, null, brief, ct);
            var cached = reply.TryGetProperty("cached", out var c) && c.ValueKind == JsonValueKind.True;
            var available = reply.TryGetProperty("available", out var a) && a.ValueKind == JsonValueKind.True;
            logger.LogInformation("Daily Report: day brief of {Date} for tenant {TenantId} {Outcome}.", day, tenantId,
                !available ? "not written (nothing to explain, or the AI could not answer)" : cached ? "unchanged (saved answer)" : "written");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (InvalidOperationException ex)
        {
            // AI off, no active provider or the daily quota used up: try again next round, quietly.
            logger.LogDebug("Daily Report: day brief of {Date} for tenant {TenantId} skipped: {Reason}", day, tenantId, ex.Message);
        }
        catch (AgentRuntimeException ex)
        {
            TellOnce($"refused:{tenantId}:{ex.Message}", $"Daily Report: the day brief of tenant {tenantId} could not be prepared: {ex.Message}");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Daily Report: the day brief of {Date} for tenant {TenantId} could not be prepared.", day, tenantId);
        }
    }

    /// <summary>The date in <paramref name="timeZone"/> (IANA or Windows id) at <paramref name="utcNow"/>; UTC when the zone
    /// is not known here (<paramref name="known"/> false).</summary>
    internal static DateOnly Today(string timeZone, DateTime utcNow, out bool known)
    {
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone.Trim());
            known = true;
            return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), zone));
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException)
        {
            known = false;
            return DateOnly.FromDateTime(utcNow);
        }
    }

    /// <summary>The day briefs kept ready: today and the <paramref name="days"/> - 1 days before it, today first.</summary>
    internal static IReadOnlyList<DailyBrief> DayBriefs(DateOnly today, int days) =>
        Enumerable.Range(0, Math.Clamp(days, 1, 7)).Select(i => new DailyBrief(today.AddDays(-i), "day", null, null, today)).ToList();

    private void TellOnce(string key, string message)
    {
        if (_toldOnce.TryAdd(key, true)) logger.LogInformation("{Message}", message);
    }

    private int Setting(string key, int fallback, int min, int max) =>
        int.TryParse(config[key], out var v) ? Math.Clamp(v, min, max) : fallback;
}
