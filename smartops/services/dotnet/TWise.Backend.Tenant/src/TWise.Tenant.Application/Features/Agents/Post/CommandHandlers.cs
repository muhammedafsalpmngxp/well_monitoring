using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class CreateAiAgentHandler(IAiAgentRepository agents) : IRequestHandler<CreateAiAgentCommand, AiAgentDto>
{
    public async Task<AiAgentDto> Handle(CreateAiAgentCommand c, CancellationToken ct)
    {
        var agent = new AiAgent { TenantId = c.TenantId, CreatedBy = c.UserName, CreatedAt = DateTime.UtcNow };
        AgentMapping.Apply(agent, c.Request);
        agents.Add(agent);
        await agents.SaveAsync(ct);
        return AgentMapping.ToDto(agent, null);
    }
}

public sealed class TestAiAgentStreamHandler(
    IAgentRuntimeClient runtime,
    IAiAgentRepository agents,
    IAiService ai,
    IAiUsageRepository usage,
    IValidator<TestAiAgentStream> validator,
    IAiPromptStore prompts) : IStreamRequestHandler<TestAiAgentStream, AiAskEvent>
{
    public async IAsyncEnumerable<AiAskEvent> Handle(TestAiAgentStream s, [EnumeratorCancellation] CancellationToken ct)
    {
        // Stream requests skip the MediatR validation pipeline, so validate here.
        var check = await validator.ValidateAsync(s, ct);
        if (!check.IsValid)
        {
            yield return Error(string.Join(" ", check.Errors.Select(e => e.ErrorMessage).Distinct()));
            yield break;
        }
        var r = s.Request;
        if (r.AgentId is { } agentId)
        {
            var saved = await agents.GetAsync(s.TenantId, agentId, ct);
            if (saved is null)
            {
                yield return Error("Agent not found.");
                yield break;
            }
            if (saved.AgentState == AgentMapping.Inactive)
            {
                yield return Error("This agent is inactive. An admin can activate it on AI Agents.");
                yield break;
            }
        }

        var inputs = r.Inputs ?? [];
        var llm = await LlmAsync(s.TenantId, r.Agent, ct);
        // The runtime has no prompt texts of its own: the tenant's (Settings → AI Prompts) go with every run.
        var texts = AiPromptCatalog.RuntimeTexts(await prompts.GetAsync(s.TenantId, ct));
        var run = new AiAgentRun
        {
            TenantId = s.TenantId, AgentId = r.AgentId, AgentName = r.Agent.Name.Trim(), RunBy = s.UserName,
            InputsJson = JsonSerializer.Serialize(inputs, AgentMapping.Json), StartedAt = DateTime.UtcNow,
        };
        var sw = Stopwatch.StartNew();
        JsonElement? done = null;
        string? error = null;
        var finished = false;
        try
        {
            await foreach (var ev in Guarded(runtime.RunAsync(r.Agent, inputs, llm, $"agent-{s.TenantId}-{Guid.NewGuid():N}", texts, ct), e => error = e, ct))
            {
                if (ev.Type == "done") done = ev.Data;
                else if (ev.Type == "error") error = Text(ev.Data, "message") ?? "The agent failed.";
                else yield return new AiAskEvent(ev.Type, ev.Data);   // step, status, node, decision, ping
            }
            finished = true;
        }
        finally
        {
            // The page went away mid-run (the stream was cancelled or disposed): the run still lands in history.
            if (!finished)
            {
                run.Seconds = Math.Round(sw.Elapsed.TotalSeconds, 1);
                run.Status = "failed";
                run.Error = "Stopped: the connection to the page closed before the run finished.";
                await agents.AddRunAsync(run, CancellationToken.None);
            }
        }

        run.Seconds = Math.Round(sw.Elapsed.TotalSeconds, 1);
        var ok = false;
        if (done is { } d)
        {
            ok = d.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
            run.Answer = Text(d, "answer");
            run.StepsJson = d.TryGetProperty("steps", out var steps) ? steps.GetRawText() : null;
            run.Status = ok ? "success" : "failed";
            if (!ok) run.Error = Trim(run.Answer ?? "No step produced an answer.");
        }
        else
        {
            run.Status = "failed";
            run.Error = Trim(error ?? "The agent runtime ended without an answer.");
        }
        // The model calls on the tenant's provider; their input, output and total tokens are saved on the run
        // (core.AiAgentRuns.input_tokens / output_tokens / total_tokens).
        var calls = done is { } final ? ProviderCalls(final) : [];
        if (calls.Count > 0)
        {
            long input = calls.Sum(c => (long)c.Prompt), output = calls.Sum(c => (long)c.Completion);
            run.InputTokens = (int)Math.Min(int.MaxValue, input);
            run.OutputTokens = (int)Math.Min(int.MaxValue, output);
            run.TotalTokens = (int)Math.Min(int.MaxValue, input + output);
        }
        // Record with a fresh token: the caller may have gone, the run must still land.
        await agents.AddRunAsync(run, CancellationToken.None);
        var llmUsed = await LogUsageAsync(s, run, calls);

        yield return done is null
            ? new AiAskEvent("error", new { message = run.Error, runId = run.Id })
            : new AiAskEvent("done", new { runId = run.Id, ok, answer = run.Answer, steps = done.Value.TryGetProperty("steps", out var st) ? st : default, seconds = run.Seconds, llm = llmUsed });
    }

    /// <summary>
    /// The tenant's AI provider: Ask Data runs every step on it, and it writes a multi-step answer. Without one
    /// (AI off, none active, over quota) Ask Data reports that, and the step answers are joined.
    /// </summary>
    private async Task<AgentRuntimeLlm?> LlmAsync(long tenantId, SaveAiAgentRequest agent, CancellationToken ct)
    {
        // Supervisor and loop decide with the model; Ask Data runs on it; several answers are combined by it.
        var needsModel = agent.Steps.Count > 1 || AgentMapping.UsesAskData(agent) || agent.Type is "supervisor" or "loop";
        if (!needsModel) return null;
        try
        {
            var (p, key) = await ai.ResolveProviderAsync(tenantId, ct);
            return new AgentRuntimeLlm(p.Provider, p.BaseUrl, p.Model, key, p.FastModel);
        }
        catch (InvalidOperationException) { return null; }
    }

    /// <summary>The model calls the runtime made with the tenant's provider: Ask Data's nodes, router / supervisor / loop
    /// decisions and the multi-step answer (the twise agents use their own provider).</summary>
    private static List<(string Model, int Prompt, int Completion)> ProviderCalls(JsonElement done) =>
        done.TryGetProperty("usage", out var rows) && rows.ValueKind == JsonValueKind.Array
            ? rows.EnumerateArray()
                .Where(u => Text(u, "agent") is { } a && (a == "agent_runtime.answer" || a.StartsWith("askdata.", StringComparison.Ordinal)))
                .Select(u => (Text(u, "model") ?? "", Int(u, "input"), Int(u, "output"))).ToList()
            : [];

    /// <summary>One AI usage row per call, naming its agent and run (AgentUsage), so the cards and the Activity Log can
    /// show what every agent used. Returns the run's totals for the page.</summary>
    private async Task<AiLlmUsageDto?> LogUsageAsync(TestAiAgentStream s, AiAgentRun run, List<(string Model, int Prompt, int Completion)> calls)
    {
        var purpose = AgentUsage.Purpose(run.AgentId, run.Id);
        foreach (var (model, prompt, completion) in calls)
            await usage.AddAsync(new AiUsageLog
            {
                TenantId = s.TenantId, UserId = s.UserId, Purpose = purpose, Model = model,
                PromptTokens = prompt, CompletionTokens = completion, Succeeded = true,
            }, CancellationToken.None);
        return AgentUsage.Summarise(calls.Select(c => new AgentUsageRow(purpose, c.Model, 1, c.Prompt, c.Completion)));
    }

    /// <summary>Turns a transport failure into an error message instead of an exception (C# forbids yield inside try/catch).</summary>
    private static async IAsyncEnumerable<AgentRuntimeEvent> Guarded(IAsyncEnumerable<AgentRuntimeEvent> source, Action<string> onError, [EnumeratorCancellation] CancellationToken ct)
    {
        await using var e = source.GetAsyncEnumerator(ct);
        while (true)
        {
            bool more;
            try { more = await e.MoveNextAsync(); }
            catch (HttpRequestException ex) { onError("The agent service failed: " + ex.Message); yield break; }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { onError("The agent service did not answer in time."); yield break; }
            // Raised before the first event (e.g. no Ask Data connection string): the reason, not a bare 500.
            catch (InvalidOperationException ex) { onError(ex.Message); yield break; }
            catch (JsonException) { onError("The agent service sent a reply that could not be read."); yield break; }
            if (!more) yield break;
            yield return e.Current;
        }
    }

    private static AiAskEvent Error(string message) => new("error", new { message });

    private static string? Text(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : 0;

    private static string Trim(string s) => s.Length <= 1000 ? s : s[..1000];
}
