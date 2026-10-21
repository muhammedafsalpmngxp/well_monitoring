using System.Text.Json;
using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>
/// Runs one claimed trigger: the saved, published agent with the trigger's inputs, recorded like a test run (by
/// "Schedule · creator"), then mails the answer when EmailTo is set and moves NextRunAt on (a once-trigger turns off).
/// </summary>
public sealed class AgentScheduleRunner(IAiAgentRepository agents, ISender sender, IMailSender mail, ILogger<AgentScheduleRunner> logger)
{
    public async Task RunAsync(long scheduleId, CancellationToken ct)
    {
        var s = await agents.GetScheduleAsync(null, scheduleId, ct);
        if (s is not { IsActive: true }) return;
        var agent = await agents.GetAsync(s.TenantId, s.AgentId, ct);
        var inputs = AgentSchedules.Inputs(s);
        string status, text;
        long? runId = null;
        if (agent is null || AgentSchedules.Problem(agent, inputs) is { } problem)
        {
            (status, text) = ("failed", agent is null ? "The agent was deleted." : AgentSchedules.Problem(agent, inputs)!);
        }
        else
        {
            AiAskEvent? last = null;
            var request = new TestAiAgentRequest(AgentMapping.ToRequest(AgentMapping.ToDto(agent, null)), inputs, agent.Id);
            await foreach (var ev in sender.CreateStream(new TestAiAgentStream(s.TenantId, "schedule", $"Schedule · {s.CreatedBy}", request), ct))
                if (ev.Type is "done" or "error") last = ev;
            var data = last is null ? default : JsonSerializer.SerializeToElement(last.Data, AgentMapping.Json);
            var ok = last?.Type == "done" && data.TryGetProperty("ok", out var o) && o.ValueKind == JsonValueKind.True;
            runId = last is not null && data.TryGetProperty("runId", out var id) && id.TryGetInt64(out var n) ? n : null;
            status = ok ? "success" : "failed";
            text = last is null ? "The run ended without an answer."
                : (data.TryGetProperty(last.Type == "done" ? "answer" : "message", out var t) ? t.GetString() : null) ?? "";
        }

        var now = DateTime.UtcNow;
        s.LastRunAt = now;
        s.LastRunId = runId;
        s.LastStatus = status;
        s.NextRunAt = Recurrence.Next(AgentSchedules.Spec(s), now);
        if (s.NextRunAt is null) s.IsActive = false;
        await agents.SaveAsync(CancellationToken.None);

        var to = AgentSchedules.Emails(s.EmailTo);
        if (to.Count == 0) return;
        try
        {
            var name = agent?.Name ?? $"Agent {s.AgentId}";
            await mail.SendAsync(new MailEnvelope(to, [], [], $"{name}: scheduled run {(status == "success" ? "answer" : "failed")}",
                $"{text}\n\n— {name}, run {runId?.ToString() ?? "-"} at {now:yyyy-MM-dd HH:mm} UTC (trigger {s.Id}).", []), ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Agent trigger {ScheduleId}: the answer could not be mailed", s.Id);
        }
    }
}
