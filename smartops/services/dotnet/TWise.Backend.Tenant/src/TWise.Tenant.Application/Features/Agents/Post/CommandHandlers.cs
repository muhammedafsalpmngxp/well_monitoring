using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
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
    IValidator<TestAiAgentStream> validator) : IStreamRequestHandler<TestAiAgentStream, AiAskEvent>
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
        if (r.AgentId is { } agentId && await agents.GetAsync(s.TenantId, agentId, ct) is null)
        {
            yield return Error("Agent not found.");
            yield break;
        }

        var inputs = r.Inputs ?? [];
        var llm = await LlmAsync(s.TenantId, r.Agent, ct);
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
            await foreach (var ev in Guarded(runtime.RunAsync(r.Agent, inputs, llm, $"agent-{s.TenantId}-{Guid.NewGuid():N}", ct), e => error = e, ct))
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
        // Record with a fresh token: the caller may have gone, the run must still land.
        await agents.AddRunAsync(run, CancellationToken.None);
        if (done is { } final) await LogUsageAsync(s, final);

        yield return done is null
            ? new AiAskEvent("error", new { message = run.Error, runId = run.Id })
            : new AiAskEvent("done", new { runId = run.Id, ok, answer = run.Answer, steps = done.Value.TryGetProperty("steps", out var st) ? st : default, seconds = run.Seconds });
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

    /// <summary>One AI usage row per model call the runtime made with the tenant's provider: Ask Data's nodes and the
    /// multi-step answer (the twise agents use their own provider).</summary>
    private async Task LogUsageAsync(TestAiAgentStream s, JsonElement done)
    {
        if (!done.TryGetProperty("usage", out var rows) || rows.ValueKind != JsonValueKind.Array) return;
        foreach (var u in rows.EnumerateArray().Where(u => Text(u, "agent") is { } a && (a == "agent_runtime.answer" || a.StartsWith("askdata.", StringComparison.Ordinal))))
            await usage.AddAsync(new AiUsageLog
            {
                TenantId = s.TenantId, UserId = s.UserId, Purpose = "agent", Model = Text(u, "model") ?? "",
                PromptTokens = Int(u, "input"), CompletionTokens = Int(u, "output"), Succeeded = true,
            }, CancellationToken.None);
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
