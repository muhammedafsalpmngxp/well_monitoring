using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Test case ↔ DTO, and the exact rules.</summary>
public static partial class AgentEvals
{
    public const int MaxCases = 50;
    public const int MaxCasesPerRun = 25;
    public static readonly string[] RuleOps = ["contains", "not_contains", "number"];

    public static AiAgentEvalCaseDto ToDto(AiAgentEvalCase c) => new(c.Id, c.Name,
        JsonSerializer.Deserialize<Dictionary<string, string>>(c.InputsJson, AgentMapping.Json) ?? [], c.Expectation,
        JsonSerializer.Deserialize<List<AiAgentEvalRuleDto>>(c.RulesJson, AgentMapping.Json) ?? [], c.CreatedBy, c.UpdatedAt);

    public static AiAgentEvalRunDto ToDto(AiAgentEvalRun r, bool withResults) => new(r.Id, r.VersionNo, r.Draft, r.Passed, r.Total,
        r.RunBy, r.StartedAt, r.Seconds, withResults ? JsonSerializer.Deserialize<List<AiAgentEvalResultDto>>(r.ResultsJson, AgentMapping.Json) : null);

    public static void Apply(AiAgentEvalCase c, SaveAiAgentEvalCaseRequest r)
    {
        c.Name = r.Name.Trim();
        c.InputsJson = JsonSerializer.Serialize(r.Inputs ?? [], AgentMapping.Json);
        c.Expectation = string.IsNullOrWhiteSpace(r.Expectation) ? null : r.Expectation.Trim();
        c.RulesJson = JsonSerializer.Serialize((r.Rules ?? []).Select(x => x with { Value = x.Value.Trim() }), AgentMapping.Json);
        c.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Why the answer breaks the rules (empty = it passes them).</summary>
    public static IReadOnlyList<string> Check(string answer, IEnumerable<AiAgentEvalRuleDto> rules)
    {
        var reasons = new List<string>();
        var numbers = Numbers().Matches(answer).Select(m => decimal.TryParse(m.Value.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var n) ? n : (decimal?)null)
            .Where(n => n is not null).ToList();
        foreach (var rule in rules)
        {
            var has = answer.Contains(rule.Value, StringComparison.OrdinalIgnoreCase);
            if (rule.Op == "contains" && !has) reasons.Add($"Does not contain \"{rule.Value}\".");
            else if (rule.Op == "not_contains" && has) reasons.Add($"Contains \"{rule.Value}\".");
            else if (rule.Op == "number" && !(decimal.TryParse(rule.Value.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var want) && numbers.Contains(want)))
                reasons.Add($"Does not give the number {rule.Value}.");
        }
        return reasons;
    }

    [GeneratedRegex(@"-?\d[\d,]*(\.\d+)?")]
    private static partial Regex Numbers();
}

public sealed class SaveAiAgentEvalCaseRequestValidator : AbstractValidator<SaveAiAgentEvalCaseRequest>
{
    public SaveAiAgentEvalCaseRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Give the test case a name.").MaximumLength(200);
        RuleFor(x => x.Expectation).MaximumLength(4000);
        RuleFor(x => x).Must(r => !string.IsNullOrWhiteSpace(r.Expectation) || r.Rules is { Count: > 0 })
            .WithMessage("Say what a good answer is: a description for the judge, or a rule.");
        RuleFor(x => x.Rules).Must(r => r is null || r.Count <= 10).WithMessage("A test case can have up to 10 rules.");
        RuleForEach(x => x.Rules).ChildRules(r =>
        {
            r.RuleFor(x => x.Op).Must(o => AgentEvals.RuleOps.Contains(o)).WithMessage("A rule is contains, not_contains or number.");
            r.RuleFor(x => x.Value).NotEmpty().WithMessage("A rule needs a value.").MaximumLength(500);
        });
        RuleFor(x => x.Inputs).Must(i => i is null || i.Values.All(v => v.Length <= 2000)).WithMessage("An input value is too long.");
    }
}

public sealed class CreateAiAgentEvalCaseCommandValidator : AbstractValidator<CreateAiAgentEvalCaseCommand>
{
    public CreateAiAgentEvalCaseCommandValidator() => RuleFor(x => x.Request).SetValidator(new SaveAiAgentEvalCaseRequestValidator());
}

public sealed class UpdateAiAgentEvalCaseCommandValidator : AbstractValidator<UpdateAiAgentEvalCaseCommand>
{
    public UpdateAiAgentEvalCaseCommandValidator() => RuleFor(x => x.Request).SetValidator(new SaveAiAgentEvalCaseRequestValidator());
}

public sealed class GetAiAgentEvalsHandler(IAiAgentRepository agents) : IRequestHandler<GetAiAgentEvalsQuery, AiAgentEvalsDto?>
{
    public async Task<AiAgentEvalsDto?> Handle(GetAiAgentEvalsQuery q, CancellationToken ct)
    {
        if (await agents.GetAsync(q.TenantId, q.AgentId, ct) is null) return null;
        var cases = await agents.ListEvalCasesAsync(q.TenantId, q.AgentId, ct);
        var runs = await agents.ListEvalRunsAsync(q.TenantId, q.AgentId, 20, ct);
        return new AiAgentEvalsDto(cases.Select(AgentEvals.ToDto).ToList(), runs.Select(r => AgentEvals.ToDto(r, false)).ToList());
    }
}

public sealed class GetAiAgentEvalRunHandler(IAiAgentRepository agents) : IRequestHandler<GetAiAgentEvalRunQuery, AiAgentEvalRunDto?>
{
    public async Task<AiAgentEvalRunDto?> Handle(GetAiAgentEvalRunQuery q, CancellationToken ct) =>
        await agents.GetEvalRunAsync(q.TenantId, q.Id, ct) is { } r && r.AgentId == q.AgentId ? AgentEvals.ToDto(r, true) : null;
}

public sealed class CreateAiAgentEvalCaseHandler(IAiAgentRepository agents) : IRequestHandler<CreateAiAgentEvalCaseCommand, AiAgentEvalCaseDto?>
{
    public async Task<AiAgentEvalCaseDto?> Handle(CreateAiAgentEvalCaseCommand c, CancellationToken ct)
    {
        if (await agents.GetAsync(c.TenantId, c.AgentId, ct) is null) return null;
        if ((await agents.ListEvalCasesAsync(c.TenantId, c.AgentId, ct)).Count >= AgentEvals.MaxCases)
            throw new InvalidOperationException($"An agent can have up to {AgentEvals.MaxCases} test cases.");
        var e = new AiAgentEvalCase { TenantId = c.TenantId, AgentId = c.AgentId, CreatedBy = c.UserName, CreatedAt = DateTime.UtcNow };
        AgentEvals.Apply(e, c.Request);
        agents.AddEvalCase(e);
        await agents.SaveAsync(ct);
        return AgentEvals.ToDto(e);
    }
}

public sealed class UpdateAiAgentEvalCaseHandler(IAiAgentRepository agents) : IRequestHandler<UpdateAiAgentEvalCaseCommand, AiAgentEvalCaseDto?>
{
    public async Task<AiAgentEvalCaseDto?> Handle(UpdateAiAgentEvalCaseCommand c, CancellationToken ct)
    {
        var e = await agents.GetEvalCaseAsync(c.TenantId, c.Id, ct);
        if (e is null || e.AgentId != c.AgentId) return null;
        AgentEvals.Apply(e, c.Request);
        await agents.SaveAsync(ct);
        return AgentEvals.ToDto(e);
    }
}

public sealed class DeleteAiAgentEvalCaseHandler(IAiAgentRepository agents) : IRequestHandler<DeleteAiAgentEvalCaseCommand, bool>
{
    public async Task<bool> Handle(DeleteAiAgentEvalCaseCommand c, CancellationToken ct)
    {
        var e = await agents.GetEvalCaseAsync(c.TenantId, c.Id, ct);
        if (e is null || e.AgentId != c.AgentId) return false;
        agents.RemoveEvalCase(e);
        await agents.SaveAsync(ct);
        return true;
    }
}

/// <summary>
/// Run all: each case runs through the Test Agent handler (same checks, model, secrets, sub-agents), then its rules
/// are checked and, when it has an expectation, the tenant's model judges the answer. The eval run is saved with the
/// score and the version it tested.
/// </summary>
public sealed class RunAiAgentEvalHandler(IAiAgentRepository agents, ISender sender, IAgentRuntimeClient runtime, IAiService ai,
    IAiPromptStore prompts)
    : IStreamRequestHandler<RunAiAgentEvalStream, AiAskEvent>
{
    public async IAsyncEnumerable<AiAskEvent> Handle(RunAiAgentEvalStream s, [EnumeratorCancellation] CancellationToken ct)
    {
        var saved = await agents.GetAsync(s.TenantId, s.AgentId, ct);
        if (saved is null)
        {
            yield return Error("Agent not found.");
            yield break;
        }
        var cases = (await agents.ListEvalCasesAsync(s.TenantId, s.AgentId, ct))
            .Where(c => s.Request.CaseIds is not { Count: > 0 } ids || ids.Contains(c.Id)).Take(AgentEvals.MaxCasesPerRun).ToList();
        if (cases.Count == 0)
        {
            yield return Error("Add a test case first.");
            yield break;
        }
        var agent = s.Request.Agent ?? AgentMapping.ToRequest(AgentMapping.ToDto(saved, null));
        AgentRuntimeLlm? judge = null;
        string? noJudge = null;
        IReadOnlyDictionary<string, string> texts = new Dictionary<string, string>();
        if (cases.Any(c => c.Expectation is not null))
        {
            try
            {
                var (p, key) = await ai.ResolveProviderAsync(s.TenantId, ct);
                judge = new AgentRuntimeLlm(p.Provider, p.BaseUrl, p.Model, key, p.FastModel);
                texts = AiPromptCatalog.RuntimeTexts(await prompts.GetAsync(s.TenantId, ct));
            }
            catch (InvalidOperationException ex) { noJudge = ex.Message; }
        }

        var started = Stopwatch.StartNew();
        var results = new List<AiAgentEvalResultDto>();
        foreach (var c in cases)
        {
            yield return new AiAskEvent("case", new { caseId = c.Id, name = c.Name, phase = "start" });
            var sw = Stopwatch.StartNew();
            var inputs = JsonSerializer.Deserialize<Dictionary<string, string>>(c.InputsJson, AgentMapping.Json) ?? [];
            AiAskEvent? last = null;
            await foreach (var ev in sender.CreateStream(new TestAiAgentStream(s.TenantId, s.UserId, $"Eval · {s.UserName}",
                               new TestAiAgentRequest(agent, inputs, s.AgentId)), ct))
                if (ev.Type is "done" or "error" or "approval") last = ev;
            var data = last is null ? default : JsonSerializer.SerializeToElement(last.Data, AgentMapping.Json);
            var answer = last?.Type == "done" && data.TryGetProperty("answer", out var a) ? a.GetString() ?? "" : null;
            long? runId = last is not null && data.TryGetProperty("runId", out var id) && id.TryGetInt64(out var n) ? n : null;
            var reasons = new List<string>();
            if (last?.Type == "approval") reasons.Add("The agent paused for Human Approval; a test case cannot approve.");
            else if (answer is null) reasons.Add(last is not null && data.TryGetProperty("message", out var m) ? m.GetString() ?? "The run failed." : "The run ended without an answer.");
            else
            {
                if (!(data.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True)) reasons.Add("The agent could not answer.");
                reasons.AddRange(AgentEvals.Check(answer, JsonSerializer.Deserialize<List<AiAgentEvalRuleDto>>(c.RulesJson, AgentMapping.Json) ?? []));
                if (c.Expectation is not null)
                {
                    string? verdict;
                    if (judge is null) verdict = "Not judged: " + noJudge;
                    else
                    {
                        try
                        {
                            var j = await runtime.JudgeAsync(judge, string.Join("; ", inputs.Select(i => $"{i.Key}: {i.Value}")), answer, c.Expectation,
                                texts, ct);
                            verdict = j.Pass ? null : "Judge: " + j.Reason;
                        }
                        catch (HttpRequestException ex) { verdict = "Not judged: " + ex.Message; }
                    }
                    if (verdict is not null) reasons.Add(verdict);
                }
            }
            var result = new AiAgentEvalResultDto(c.Id, c.Name, reasons.Count == 0, reasons, answer is null ? null : Cut(answer), runId,
                Math.Round(sw.Elapsed.TotalSeconds, 1));
            results.Add(result);
            yield return new AiAskEvent("case", new { caseId = c.Id, name = c.Name, phase = "end", result.Passed, result.Reasons, result.Answer, result.RunId, result.Seconds });
        }

        var latest = await agents.GetVersionAsync(s.TenantId, s.AgentId, 0, CancellationToken.None);
        var evalRun = new AiAgentEvalRun
        {
            TenantId = s.TenantId, AgentId = s.AgentId, VersionNo = latest?.VersionNo, Draft = s.Request.Draft,
            Passed = results.Count(r => r.Passed), Total = results.Count, ResultsJson = JsonSerializer.Serialize(results, AgentMapping.Json),
            RunBy = s.UserName, StartedAt = DateTime.UtcNow, Seconds = Math.Round(started.Elapsed.TotalSeconds, 1),
        };
        await agents.AddEvalRunAsync(evalRun, CancellationToken.None);
        yield return new AiAskEvent("done", new { evalRunId = evalRun.Id, evalRun.Passed, evalRun.Total, evalRun.VersionNo, evalRun.Draft, evalRun.Seconds });
    }

    private static AiAskEvent Error(string message) => new("error", new { message });

    private static string Cut(string s) => s.Length <= 2000 ? s : s[..2000] + "…";
}
