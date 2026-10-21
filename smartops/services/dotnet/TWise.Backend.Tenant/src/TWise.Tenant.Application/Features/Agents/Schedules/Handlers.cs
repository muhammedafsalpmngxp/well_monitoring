using System.Text.Json;
using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Trigger ↔ DTO, and the checks a trigger's agent must pass.</summary>
public static class AgentSchedules
{
    public static RecurrenceSpec Spec(AiAgentSchedule s) => new(s.Cron, s.RunOnceAt, s.TimeZone, null, null);

    public static AiAgentScheduleDto ToDto(AiAgentSchedule s) => new(
        s.Id, s.Cron, s.RunOnceAt, s.TimeZone, Inputs(s), Emails(s.EmailTo), s.IsActive, s.NextRunAt, s.LastRunAt, s.LastRunId,
        s.LastStatus, s.CreatedBy, Recurrence.Problem(Spec(s)) is null ? Recurrence.NextFive(Spec(s), DateTime.UtcNow) : []);

    public static Dictionary<string, string> Inputs(AiAgentSchedule s) =>
        JsonSerializer.Deserialize<Dictionary<string, string>>(s.InputsJson, AgentMapping.Json) ?? [];

    public static IReadOnlyList<string> Emails(string? list) =>
        (list ?? "").Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public static void Apply(AiAgentSchedule s, SaveAiAgentScheduleRequest r)
    {
        s.Cron = string.IsNullOrWhiteSpace(r.Cron) ? null : r.Cron.Trim();
        s.RunOnceAt = s.Cron is null ? r.RunOnceAt is { } at ? Recurrence.AsUtc(at) : null : null;
        s.TimeZone = r.TimeZone.Trim();
        s.InputsJson = JsonSerializer.Serialize(r.Inputs ?? [], AgentMapping.Json);
        s.EmailTo = r.EmailTo is { Count: > 0 } to ? string.Join(",", to.Select(e => e.Trim())) : null;
        s.IsActive = r.IsActive;
        s.NextRunAt = s.IsActive ? Recurrence.Next(Spec(s), DateTime.UtcNow) : null;
        s.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Why the agent cannot run on a schedule with these inputs, or null.</summary>
    public static string? Problem(AiAgent agent, IReadOnlyDictionary<string, string> inputs)
    {
        if (agent.Status != "published") return "Publish the agent before it runs on a schedule.";
        var a = AgentMapping.ToRequest(AgentMapping.ToDto(agent, null));
        if (AgentMapping.UsesTool(a, AgentMapping.ApprovalTool)) return "An agent with a Human Approval step cannot run on a schedule: no one would be there to approve.";
        var missing = (a.Inputs ?? []).Where(i => i.Required && string.IsNullOrWhiteSpace(inputs.GetValueOrDefault(i.Name))).Select(i => i.Name).ToList();
        return missing.Count > 0 ? "Fill in the inputs: " + string.Join(", ", missing) : null;
    }
}

public sealed class SaveAiAgentScheduleRequestValidator : AbstractValidator<SaveAiAgentScheduleRequest>
{
    public SaveAiAgentScheduleRequestValidator()
    {
        RuleFor(x => x).Must(r => Recurrence.Problem(new RecurrenceSpec(r.Cron, r.RunOnceAt, r.TimeZone, null, null)) is null)
            .WithMessage(r => Recurrence.Problem(new RecurrenceSpec(r.Cron, r.RunOnceAt, r.TimeZone, null, null)) ?? "");
        RuleFor(x => x.Cron).MaximumLength(100);
        RuleFor(x => x.EmailTo).Must(e => e is null || e.Count <= 10).WithMessage("Mail the answer to at most 10 addresses.");
        RuleForEach(x => x.EmailTo).EmailAddress().WithMessage("\"{PropertyValue}\" is not an e-mail address.");
        RuleFor(x => x.Inputs).Must(i => i is null || i.Values.All(v => v.Length <= 2000)).WithMessage("An input value is too long.");
    }
}

public sealed class CreateAiAgentScheduleCommandValidator : AbstractValidator<CreateAiAgentScheduleCommand>
{
    public CreateAiAgentScheduleCommandValidator() => RuleFor(x => x.Request).SetValidator(new SaveAiAgentScheduleRequestValidator());
}

public sealed class UpdateAiAgentScheduleCommandValidator : AbstractValidator<UpdateAiAgentScheduleCommand>
{
    public UpdateAiAgentScheduleCommandValidator() => RuleFor(x => x.Request).SetValidator(new SaveAiAgentScheduleRequestValidator());
}

public sealed class ListAiAgentSchedulesHandler(IAiAgentRepository agents) : IRequestHandler<ListAiAgentSchedulesQuery, IReadOnlyList<AiAgentScheduleDto>?>
{
    public async Task<IReadOnlyList<AiAgentScheduleDto>?> Handle(ListAiAgentSchedulesQuery q, CancellationToken ct) =>
        await agents.GetAsync(q.TenantId, q.AgentId, ct) is null ? null
            : (await agents.ListSchedulesAsync(q.TenantId, q.AgentId, ct)).Select(AgentSchedules.ToDto).ToList();
}

public sealed class CreateAiAgentScheduleHandler(IAiAgentRepository agents) : IRequestHandler<CreateAiAgentScheduleCommand, AiAgentScheduleDto?>
{
    public async Task<AiAgentScheduleDto?> Handle(CreateAiAgentScheduleCommand c, CancellationToken ct)
    {
        var agent = await agents.GetAsync(c.TenantId, c.AgentId, ct);
        if (agent is null) return null;
        if (c.Request.IsActive && AgentSchedules.Problem(agent, c.Request.Inputs ?? []) is { } problem) throw new InvalidOperationException(problem);
        var s = new AiAgentSchedule { TenantId = c.TenantId, AgentId = c.AgentId, CreatedBy = c.UserName, CreatedAt = DateTime.UtcNow };
        AgentSchedules.Apply(s, c.Request);
        agents.AddSchedule(s);
        await agents.SaveAsync(ct);
        return AgentSchedules.ToDto(s);
    }
}

public sealed class UpdateAiAgentScheduleHandler(IAiAgentRepository agents) : IRequestHandler<UpdateAiAgentScheduleCommand, AiAgentScheduleDto?>
{
    public async Task<AiAgentScheduleDto?> Handle(UpdateAiAgentScheduleCommand c, CancellationToken ct)
    {
        var s = await agents.GetScheduleAsync(c.TenantId, c.Id, ct);
        var agent = s?.AgentId == c.AgentId ? await agents.GetAsync(c.TenantId, c.AgentId, ct) : null;
        if (s is null || agent is null) return null;
        if (c.Request.IsActive && AgentSchedules.Problem(agent, c.Request.Inputs ?? []) is { } problem) throw new InvalidOperationException(problem);
        AgentSchedules.Apply(s, c.Request);
        await agents.SaveAsync(ct);
        return AgentSchedules.ToDto(s);
    }
}

public sealed class DeleteAiAgentScheduleHandler(IAiAgentRepository agents) : IRequestHandler<DeleteAiAgentScheduleCommand, bool>
{
    public async Task<bool> Handle(DeleteAiAgentScheduleCommand c, CancellationToken ct)
    {
        var s = await agents.GetScheduleAsync(c.TenantId, c.Id, ct);
        if (s is null || s.AgentId != c.AgentId) return false;
        agents.RemoveSchedule(s);
        await agents.SaveAsync(ct);
        return true;
    }
}

public sealed class RunAiAgentScheduleNowHandler(IAiAgentRepository agents) : IRequestHandler<RunAiAgentScheduleNowCommand, bool>
{
    public async Task<bool> Handle(RunAiAgentScheduleNowCommand c, CancellationToken ct)
    {
        var s = await agents.GetScheduleAsync(c.TenantId, c.Id, ct);
        if (s is null || s.AgentId != c.AgentId) return false;
        if (!s.IsActive) throw new InvalidOperationException("Turn the trigger on before running it.");
        s.NextRunAt = DateTime.UtcNow;
        await agents.SaveAsync(ct);
        return true;
    }
}

public sealed class PreviewAgentScheduleHandler : IRequestHandler<PreviewAgentScheduleQuery, AgentSchedulePreviewDto>
{
    public Task<AgentSchedulePreviewDto> Handle(PreviewAgentScheduleQuery q, CancellationToken ct)
    {
        var spec = new RecurrenceSpec(q.Request.Cron, q.Request.RunOnceAt, q.Request.TimeZone, null, null);
        var problem = Recurrence.Problem(spec);
        return Task.FromResult(new AgentSchedulePreviewDto(problem, problem is null ? Recurrence.NextFive(spec, DateTime.UtcNow) : []));
    }
}
