using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>
/// One run of a schedule, end to end: reads the owner from the control plane (an inactive owner fails the run), renders
/// the item as the owner (who must still view the item's page and schedules), skips an empty result when asked, resolves the recipients, fills in the tokens, sends (three
/// tries, 1 s and 5 s apart, for send failures only) and logs the run. A scheduled run then moves NextRunAt on, and a
/// schedule with no run left is switched off. A test goes to the owner only and saves nothing.
/// </summary>
public sealed class DeliveryRunner(
    IScheduleStore store, IMailGroupStore groups, IRecipientResolver directory, IEnumerable<IDeliveryRenderer> renderers,
    IMailSender mail, ILogger<DeliveryRunner> logger)
{
    private const int MaxError = 2000;
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5)];

    /// <summary>How the runner waits between send attempts; tests replace it.</summary>
    public Func<TimeSpan, CancellationToken, Task> Delay { get; init; } = Task.Delay;

    public async Task<ScheduleRun> RunAsync(Schedule schedule, string trigger, DateTime nowUtc, CancellationToken ct)
    {
        var test = trigger == DeliveryTerms.Test;
        var run = new ScheduleRun
        {
            TenantId = schedule.TenantId, ScheduleId = test ? null : schedule.Id, ScheduleName = schedule.Name,
            TargetType = schedule.TargetType, TargetId = schedule.TargetId, Trigger = trigger, StartedAt = nowUtc,
        };
        try
        {
            await DeliverAsync(schedule, run, test, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            if (ex is not DeliveryException) logger.LogError(ex, "Scheduled delivery {ScheduleId} failed", schedule.Id);
            run.Status = DeliveryTerms.Failed;
            run.Error = Trim(ex.Message);
        }
        run.FinishedAt = DateTime.UtcNow;
        if (test) return run;

        // Record over the row as it is now, so an edit, pause or delete made during the run is kept.
        // ponytail: an edit landing between this read and the save below is still overwritten; add a rowversion if that shows.
        await store.ReloadAsync(schedule, ct);
        schedule.LastRunAt = nowUtc;
        schedule.LastStatus = run.Status;
        if (trigger == DeliveryTerms.OnSchedule && schedule.IsActive && !schedule.IsDeleted)
        {
            schedule.NextRunAt = Recurrence.Problem(Spec(schedule)) is null ? Recurrence.Next(Spec(schedule), nowUtc) : null;
            if (schedule.NextRunAt is null) schedule.IsActive = false;
        }
        await store.AddRunAsync(run, ct);
        await store.SaveAsync(ct);
        return run;
    }

    private async Task DeliverAsync(Schedule schedule, ScheduleRun run, bool test, CancellationToken ct)
    {
        var owner = (await directory.ResolveAsync(schedule.TenantId, [schedule.OwnerUserId], [], ct))
            .FirstOrDefault(u => u.UserId == schedule.OwnerUserId);
        if (owner is not { IsActive: true })
            throw new DeliveryException("The schedule's owner is inactive or no longer has access to this tenant.");
        if (!owner.CanView(ModulePermission.Schedules))
            throw new DeliveryException("The schedule's owner no longer has access to schedules.");
        if (!ScheduleRules.CanView(schedule.TargetType, owner.CanView))
            throw new DeliveryException($"The schedule's owner can no longer view this {schedule.TargetType.ToLowerInvariant()}.");
        var renderer = renderers.FirstOrDefault(r => r.TargetType == schedule.TargetType)
            ?? throw new DeliveryException($"{schedule.TargetType} items cannot be sent.");

        RenderedDelivery rendered;
        using (RunAsScope.Begin(owner)) rendered = await renderer.RenderAsync(schedule, ct);
        run.TargetName = rendered.TargetName;
        run.AttachmentBytes = rendered.Attachments.Sum(a => (long)a.Content.Length);
        if (schedule.SkipIfEmpty && rendered.IsEmpty)
        {
            run.Status = DeliveryTerms.Skipped;
            return;
        }

        var (to, cc, bcc) = test ? ([owner.Email], new List<string>(), new List<string>()) : await RecipientsAsync(schedule, ct);
        if (to.Count + cc.Count + bcc.Count == 0) throw new DeliveryException("None of the recipients has an email address.");

        var tokens = MessageTokens.Values(schedule.Name, rendered.TargetName, run.StartedAt, schedule.TimeZone, rendered.Link, owner.Name ?? owner.Email, rendered.Text);
        // A token value could hold a line break; a subject must stay one line.
        var subject = MessageTokens.Apply(schedule.Subject, tokens).ReplaceLineEndings(" ");
        var body = MessageTokens.Apply(schedule.Body, tokens);
        // A report written into the mail goes where {{report}} is, else after the message.
        if (!string.IsNullOrEmpty(rendered.Text) && !schedule.Body.Contains("{{report}}", StringComparison.Ordinal))
            body = $"{body}\n\n{rendered.Text}".TrimStart();
        if (!body.Contains(rendered.Link, StringComparison.Ordinal)) body = $"{body}\n\n{rendered.Link}".TrimStart();
        var envelope = new MailEnvelope(to, cc, bcc, subject, body, rendered.Attachments);

        MailResult result;
        while (true)
        {
            run.Attempt++;
            try
            {
                result = await mail.SendAsync(envelope, ct);
                break;
            }
            catch (Exception ex) when (run.Attempt <= Backoff.Length && !ct.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Sending scheduled delivery {ScheduleId}, attempt {Attempt}, failed", schedule.Id, run.Attempt);
                await Delay(Backoff[run.Attempt - 1], ct);
            }
        }

        run.RecipientCount = to.Count + cc.Count + bcc.Count - result.Refused.Count;
        var notes = new List<string>();
        if (rendered.Note is { Length: > 0 } skipped) notes.Add(skipped);
        if (result.Refused.Count > 0) notes.Add($"Not sent to addresses outside the allowed domains: {string.Join(", ", result.Refused)}");
        if (result.Note is { Length: > 0 } note) notes.Add(note);
        if (notes.Count > 0) run.Error = Trim(string.Join(" ", notes));
        run.Status = run.RecipientCount > 0 ? DeliveryTerms.Sent : DeliveryTerms.Failed;
    }

    /// <summary>Every recipient as addresses, each address once, in the first of To, Cc and Bcc it appears in.</summary>
    private async Task<(List<string> To, List<string> Cc, List<string> Bcc)> RecipientsAsync(Schedule schedule, CancellationToken ct)
    {
        var recipients = schedule.Recipients;
        var userIds = recipients.Where(r => r.RecipientType == "User").Select(r => long.TryParse(r.Value, out var id) ? id : 0).Where(id => id > 0).ToHashSet();
        var roleCodes = recipients.Where(r => r.RecipientType == "Role").Select(r => r.Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var groupIds = recipients.Where(r => r.RecipientType == "Group").Select(r => long.TryParse(r.Value, out var id) ? id : 0).Where(id => id > 0).ToHashSet();

        var users = userIds.Count + roleCodes.Count > 0
            ? (await directory.ResolveAsync(schedule.TenantId, userIds, roleCodes, ct)).Where(u => u.IsActive).ToList()
            : [];
        var members = groupIds.Count > 0 ? await groups.MembersAsync(schedule.TenantId, groupIds, ct) : new Dictionary<long, IReadOnlyList<string>>();

        IEnumerable<string> Addresses(ScheduleRecipient r) => r.RecipientType switch
        {
            "User" => users.Where(u => u.UserId.ToString() == r.Value).Select(u => u.Email),
            "Role" => users.Where(u => u.RoleCodes.Contains(r.Value, StringComparer.OrdinalIgnoreCase)).Select(u => u.Email),
            "Group" => long.TryParse(r.Value, out var id) ? members.GetValueOrDefault(id) ?? [] : [],
            _ => [r.Value],
        };

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        List<string> For(string kind) => recipients.Where(r => r.Kind == kind).SelectMany(Addresses)
            .Select(a => a.Trim()).Where(a => a.Length > 0 && seen.Add(a)).ToList();
        return (For("To"), For("Cc"), For("Bcc"));
    }

    private static RecurrenceSpec Spec(Schedule s) => new(s.Cron, s.RunOnceAt, s.TimeZone, s.StartAt, s.EndAt);

    private static string Trim(string message) => message.Length <= MaxError ? message : message[..MaxError];
}
