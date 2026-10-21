using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class CreateAiAgentHandler(IAiAgentRepository agents, IAiKeyProtector keys) : IRequestHandler<CreateAiAgentCommand, AiAgentDto>
{
    public async Task<AiAgentDto> Handle(CreateAiAgentCommand c, CancellationToken ct)
    {
        var agent = new AiAgent { TenantId = c.TenantId, CreatedBy = c.UserName, CreatedAt = DateTime.UtcNow };
        AgentMapping.Apply(agent, c.Request, keys);
        agents.Add(agent);
        await agents.SaveAsync(ct);
        await AgentVersioning.RecordAsync(agents, agent, c.UserName, ct);
        return AgentMapping.ToDto(agent, null);
    }
}

public sealed class TestAiAgentStreamHandler(
    IAgentRuntimeClient runtime,
    IAiAgentRepository agents,
    IAiService ai,
    IAiUsageRepository usage,
    IValidator<TestAiAgentStream> validator,
    IAiPromptStore prompts,
    IAiSettingsRepository aiSettings,
    IAiKeyProtector keys,
    IValidator<ResumeAiAgentRunStream> resumeValidator) : IStreamRequestHandler<TestAiAgentStream, AiAskEvent>, IStreamRequestHandler<ResumeAiAgentRunStream, AiAskEvent>
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
        var saved = r.AgentId is { } agentId ? await agents.GetAsync(s.TenantId, agentId, ct) : null;
        if (r.AgentId is not null && saved is null)
        {
            yield return Error("Agent not found.");
            yield break;
        }
        if (saved?.AgentState == AgentMapping.Inactive)
        {
            yield return Error("This agent is inactive. An admin can activate it on AI Agents.");
            yield break;
        }
        var thread = r.ThreadId is null ? [] : (await agents.ListThreadAsync(s.TenantId, r.ThreadId, ThreadTurns, ct))
            .Select(t => new AgentThreadTurn(Said(t.InputsJson), t.Answer ?? "")).ToList();
        var (ctx, problem) = await PrepareAsync(s.TenantId, saved, r.Agent, r.Inputs ?? [], thread, $"agent-{s.TenantId}-{Guid.NewGuid():N}", ct);
        if (problem is not null)
        {
            yield return Error(problem);
            yield break;
        }
        var run = new AiAgentRun
        {
            TenantId = s.TenantId, AgentId = r.AgentId, AgentName = r.Agent.Name.Trim(), RunBy = s.UserName, ThreadId = r.ThreadId,
            InputsJson = JsonSerializer.Serialize(ctx!.Inputs, AgentMapping.Json), StartedAt = DateTime.UtcNow,
        };
        await foreach (var ev in TrackAsync(runtime.RunAsync(ctx, ct), run, ctx, () => agents.AddRunAsync(run, CancellationToken.None),
                           s.TenantId, s.UserId, Remembers(saved, ctx.Agent) ? saved!.Id : null, ct))
            yield return ev;
    }

    public async IAsyncEnumerable<AiAskEvent> Handle(ResumeAiAgentRunStream s, [EnumeratorCancellation] CancellationToken ct)
    {
        var check = await resumeValidator.ValidateAsync(s, ct);
        if (!check.IsValid)
        {
            yield return Error(string.Join(" ", check.Errors.Select(e => e.ErrorMessage).Distinct()));
            yield break;
        }
        var run = await agents.GetRunAsync(s.TenantId, s.RunId, ct);
        var paused = run is { Status: "waiting", ResumeJson: { } json } ? JsonSerializer.Deserialize<PausedRun>(json, AgentMapping.Json) : null;
        if (run is null || paused is null || paused.Token != s.Request.Token)
        {
            yield return Error("This run is not waiting for an approval.");
            yield break;
        }
        var saved = run.AgentId is { } agentId ? await agents.GetAsync(s.TenantId, agentId, ct) : null;
        // The model, tool secrets, sub-agents and memories are read again now: a paused run keeps no secrets.
        var (ctx, problem) = await PrepareAsync(s.TenantId, saved, paused.Agent, paused.Inputs, paused.Thread, paused.Token, ct);
        if (problem is not null)
        {
            yield return Error(problem);
            yield break;
        }
        var resume = new AgentResume(paused.State, paused.Node, s.Request.Decision, s.Request.Text, s.UserName);
        await foreach (var ev in TrackAsync(runtime.ResumeAsync(ctx!, resume, ct), run, ctx!, () => agents.SaveAsync(CancellationToken.None),
                           s.TenantId, s.UserId, Remembers(saved, ctx!.Agent) ? saved!.Id : null, ct))
            yield return ev;
    }

    /// <summary>What a paused run keeps (no secrets) to be resumed later, even after restarts.</summary>
    private sealed record PausedRun(SaveAiAgentRequest Agent, Dictionary<string, string> Inputs, IReadOnlyList<AgentThreadTurn> Thread,
        string Token, JsonElement State, string Node);

    /// <summary>Earlier turns of a conversation given to a run.</summary>
    public const int ThreadTurns = 10;

    private static bool Remembers(AiAgent? saved, SaveAiAgentRequest agent) => saved is not null && AgentMapping.UsesMemory(agent);

    /// <summary>A run's inputs as the "user" side of a conversation turn.</summary>
    private static string Said(string inputsJson)
    {
        var inputs = JsonSerializer.Deserialize<Dictionary<string, string>>(inputsJson, AgentMapping.Json) ?? [];
        return inputs.Count == 1 ? inputs.Values.First() : string.Join("; ", inputs.Select(i => $"{i.Key}: {i.Value}"));
    }

    /// <summary>
    /// The run context: tool secrets (the saved agent's when the draft has none), the published sub-agents, the model
    /// (or why it cannot be used when a step needs it) and the saved agent's memories. Problem = why it cannot run.
    /// </summary>
    private async Task<(AgentRunContext? Run, string? Problem)> PrepareAsync(long tenantId, AiAgent? saved, SaveAiAgentRequest agent,
        IReadOnlyDictionary<string, string> inputs, IReadOnlyList<AgentThreadTurn> thread, string sessionId, CancellationToken ct)
    {
        agent = agent with { CustomTools = AgentMapping.WithSecrets(agent.CustomTools, saved, keys) };
        var (subagents, subError) = await SubAgentsAsync(tenantId, saved?.Id, agent, ct);
        if (subError is not null) return (null, subError);
        var (llm, noModel) = await LlmAsync(tenantId, agent, inputs, ct);
        // Steps that run on the model cannot run without it: say why (AI off, no provider, quota, unreadable key).
        if (llm is null && noModel is not null && (AgentMapping.UsesAskData(agent)
                || AgentMapping.ModelTools.Any(t => AgentMapping.UsesTool(agent, t)) || agent.Type is "supervisor" or "loop"))
            return (null, "The AI provider cannot be used: " + noModel);
        // Memory belongs to a saved agent: a draft never tested before has none and keeps none.
        IReadOnlyList<string> memories = Remembers(saved, agent)
            ? (await agents.ListMemoriesAsync(tenantId, saved!.Id, MemoryKeep, ct)).Select(m => m.Text).ToList() : [];
        // The runtime has no prompt texts of its own: the tenant's (Settings → AI Prompts) go with every run; so do its
        // Ask Data settings (what Ask Data and Saved SQL may read, and their limits; Settings → AI Settings).
        var texts = AiPromptCatalog.RuntimeTexts(await prompts.GetAsync(tenantId, ct));
        var askData = AskDataSettingsRules.ToRuntime(await aiSettings.GetAsync(tenantId, ct));
        return (new AgentRunContext(agent, inputs, llm, memories, subagents, thread, sessionId, texts, askData), null);
    }

    /// <summary>
    /// Passes the runtime's progress to the page and records the run: done = success / failed (with usage and new
    /// memories), approval = waiting (resumable), a closed page = stopped. <paramref name="save"/> stores the run.
    /// </summary>
    private async IAsyncEnumerable<AiAskEvent> TrackAsync(IAsyncEnumerable<AgentRuntimeEvent> source, AiAgentRun run, AgentRunContext ctx, Func<Task> save,
        long tenantId, string userId, long? memoryAgentId, [EnumeratorCancellation] CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var spent = run.Seconds;   // a resumed run adds to its first part
        JsonElement? done = null, approval = null;
        string? error = null;
        var finished = false;
        try
        {
            await foreach (var ev in Guarded(source, e => error = e, ct))
            {
                if (ev.Type == "done") done = ev.Data;
                else if (ev.Type == "approval") approval = ev.Data;
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
                run.Seconds = Math.Round(spent + sw.Elapsed.TotalSeconds, 1);
                run.Status = "failed";
                run.Error = "Stopped: the connection to the page closed before the run finished.";
                await save();
            }
        }

        run.Seconds = Math.Round(spent + sw.Elapsed.TotalSeconds, 1);
        if (approval is { } wait)
        {
            run.Status = "waiting";
            run.Error = null;
            run.StepsJson = wait.TryGetProperty("steps", out var soFar) ? soFar.GetRawText() : null;
            // Kept until the decision: the run as sent (tool secrets removed), the paused state and step.
            run.ResumeJson = JsonSerializer.Serialize(new PausedRun(
                ctx.Agent with { CustomTools = ctx.Agent.CustomTools?.Select(t => t with { AuthSecret = null }).ToList() },
                new Dictionary<string, string>(ctx.Inputs), ctx.Thread, Text(wait, "token") ?? ctx.SessionId,
                wait.TryGetProperty("state", out var state) ? state.Clone() : default, Text(wait, "node") ?? ""), AgentMapping.Json);
            await save();
            yield return new AiAskEvent("approval", new
            {
                runId = run.Id, token = Text(wait, "token"), step = wait.TryGetProperty("step", out var at) ? at : default,
                question = Text(wait, "question"), draft = Text(wait, "draft"), steps = soFar,
            });
            yield break;
        }
        run.ResumeJson = null;
        var ok = false;
        IReadOnlyList<AgentModelUsage> usage = [];
        if (done is { } d)
        {
            usage = AgentMapping.Usage(d);
            run.UsageJson = usage.Count > 0 ? JsonSerializer.Serialize(usage, AgentMapping.Json) : null;
            ok = d.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
            run.Answer = Text(d, "answer");
            run.StepsJson = d.TryGetProperty("steps", out var steps) ? steps.GetRawText() : null;
            run.Status = ok ? "success" : "failed";
            run.Error = ok ? null : Trim(run.Answer ?? "No step produced an answer.");
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
        await save();
        var llmUsed = await LogUsageAsync(tenantId, userId, run, calls);
        if (memoryAgentId is { } agentId && ok && done is { } withFacts && withFacts.TryGetProperty("memories", out var facts) && facts.ValueKind == JsonValueKind.Array)
            await agents.AddMemoriesAsync(facts.EnumerateArray().Where(f => f.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(f.GetString()))
                .Select(f => new AiAgentMemory { TenantId = tenantId, AgentId = agentId, Text = Trim(f.GetString()!.Trim()), RunId = run.Id })
                .ToList(), MemoryKeep, CancellationToken.None);

        yield return done is null
            ? new AiAskEvent("error", new { message = run.Error, runId = run.Id })
            : new AiAskEvent("done", new
            {
                runId = run.Id, ok, answer = run.Answer, steps = done.Value.TryGetProperty("steps", out var st) ? st : default, seconds = run.Seconds,
                output = done.Value.TryGetProperty("output", out var o) ? o : (JsonElement?)null,
                usage, llm = llmUsed,
            });
    }

    /// <summary>
    /// The tenant's AI provider: Ask Data runs every step on it, and it writes a multi-step answer. Without one
    /// (AI off, none active, over quota) Ask Data reports that, and the step answers are joined.
    /// </summary>
    /// <returns>The provider, or null with the reason it cannot be used (null reason: no step needs it).</returns>
    private async Task<(AgentRuntimeLlm? Llm, string? Reason)> LlmAsync(long tenantId, SaveAiAgentRequest agent,
        IReadOnlyDictionary<string, string> inputs, CancellationToken ct)
    {
        // Supervisor and loop decide with the model; Ask Data and the model tools run on it; several answers are combined
        // by it, and so are a Saved SQL step's rows with the summary action. A lone Saved SQL step with the table action
        // needs none. A question typed in is read with one call on the fast model.
        var needsModel = agent.Steps.Count > 1 || AgentMapping.UsesAskData(agent) || AgentMapping.SummarisesSql(agent)
            || AgentMapping.ModelTools.Any(t => AgentMapping.UsesTool(agent, t))
            || agent.Type is "supervisor" or "loop" || AgentMapping.HasQuestion(agent, inputs);
        if (!needsModel) return (null, null);
        try
        {
            var (p, key) = await ai.ResolveProviderAsync(tenantId, ct);
            return (new AgentRuntimeLlm(p.Provider, p.BaseUrl, p.Model, key, p.FastModel), null);
        }
        catch (InvalidOperationException ex) { return (null, ex.Message); }
    }

    /// <summary>The model calls the runtime made with the tenant's provider: Ask Data's nodes, router / supervisor / loop
    /// decisions, the multi-step answer and reading a question (the twise agents use their own provider).</summary>
    private static List<(string Model, int Prompt, int Completion)> ProviderCalls(JsonElement done) =>
        done.TryGetProperty("usage", out var rows) && rows.ValueKind == JsonValueKind.Array
            ? rows.EnumerateArray()
                .Where(u => Text(u, "agent") is { } a
                    && (a.StartsWith("agent_runtime.", StringComparison.Ordinal) || a.StartsWith("askdata.", StringComparison.Ordinal)))
                .Select(u => (Text(u, "model") ?? "", Int(u, "input"), Int(u, "output"))).ToList()
            : [];

    /// <summary>One AI usage row per call, naming its agent and run (AgentUsage), so the cards and the Activity Log can
    /// show what every agent used. Returns the run's totals for the page.</summary>
    private async Task<AiLlmUsageDto?> LogUsageAsync(long tenantId, string userId, AiAgentRun run,
        List<(string Model, int Prompt, int Completion)> calls)
    {
        var purpose = AgentUsage.Purpose(run.AgentId, run.Id);
        foreach (var (model, prompt, completion) in calls)
            await usage.AddAsync(new AiUsageLog
            {
                TenantId = tenantId, UserId = userId, Purpose = purpose, Model = model,
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

    /// <summary>
    /// The published agents the steps run as sub-agents, and theirs, up to MaxSubAgentDepth levels, with their tool
    /// secrets. An agent that reaches itself, an unknown or unpublished agent, or deeper nesting is refused.
    /// </summary>
    private async Task<(Dictionary<string, SaveAiAgentRequest> Map, string? Error)> SubAgentsAsync(long tenantId, long? selfId,
        SaveAiAgentRequest root, CancellationToken ct)
    {
        var map = new Dictionary<string, SaveAiAgentRequest>();
        var level = new List<(SaveAiAgentRequest Agent, string[] Path)> { (root, selfId is { } id ? [id.ToString()] : []) };
        for (var depth = 1; level.Count > 0; depth++)
        {
            var next = new List<(SaveAiAgentRequest, string[])>();
            foreach (var (agent, path) in level)
                foreach (var subId in AgentMapping.SubAgentIds(agent))
                {
                    if (path.Contains(subId)) return (map, "An agent cannot run itself as a sub-agent, directly or through another agent.");
                    if (depth > AgentMapping.MaxSubAgentDepth) return (map, $"Sub-agents can be nested {AgentMapping.MaxSubAgentDepth} levels deep.");
                    if (!map.TryGetValue(subId, out var sub))
                    {
                        var saved = long.TryParse(subId, out var n) ? await agents.GetAsync(tenantId, n, ct) : null;
                        if (saved is null || saved.Status != "published") return (map, $"Sub-agent {subId} is not a published agent of this tenant.");
                        var dto = AgentMapping.ToDto(saved, null);
                        map[subId] = sub = AgentMapping.ToRequest(dto) with { CustomTools = AgentMapping.WithSecrets(dto.CustomTools, saved, keys) };
                    }
                    next.Add((sub, [.. path, subId]));
                }
            level = next;
        }
        return (map, null);
    }

    /// <summary>Memories kept per agent (and sent to each run).</summary>
    public const int MemoryKeep = 200;

    private static AiAskEvent Error(string message) => new("error", new { message });

    private static string? Text(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : 0;

    private static string Trim(string s) => s.Length <= 1000 ? s : s[..1000];
}
