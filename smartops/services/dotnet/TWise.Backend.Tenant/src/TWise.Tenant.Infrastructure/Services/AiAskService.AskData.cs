using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Ask your data without a dataset: the question goes to the agent runtime's Ask Data graph (orchestrator, planner,
/// SQL author, validator, executor, analysis, verifier, synthesize) over the Ask Data database, the same graph an
/// agent's ask_data step runs. The panel gets status events while it runs, then "sql" (the query, whether the verifier
/// accepted it, how many queries ran), "result" (the last query's rows), "answer" (markdown, one event) and "done".
/// </summary>
public sealed partial class AiAskService
{
    /// <summary>Conversation source type and name for Ask Data questions (no dataset).</summary>
    private const string AskDataSource = "askdata";
    private const string AskDataName = "Ask Data";

    private async IAsyncEnumerable<AiAskEvent> AskDataAsync(AiConversation conv, string question, bool tracing,
        long tenantId, long userId, [EnumeratorCancellation] CancellationToken ct)
    {
        AgentRuntimeLlm? llm = null;
        string? failed = null;
        try
        {
            var (p, key) = await ai.ResolveProviderAsync(tenantId, ct);
            llm = new AgentRuntimeLlm(p.Provider, p.BaseUrl, p.Model, key, p.FastModel);
        }
        catch (InvalidOperationException ex) { failed = ex.Message; }
        if (llm is null) { yield return Error(failed ?? "No AI provider is active. An admin can set one under Settings → AI."); yield break; }

        var history = conv.Id == 0 ? [] : HistoryPairs(await conversations.GetMessagesAsync(conv.Id, ct));
        var trace = new List<AiTraceStep>();
        var started = Stopwatch.GetTimestamp();
        var nodes = new List<string>();
        JsonElement? done = null;
        yield return new AiAskEvent("status", "Understanding your question…");
        // What Ask Data may read and its limits come from the tenant's AI Settings; so does how much history it keeps.
        // ... with the tenant's business terms and column names (Terms & column names).
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(tenantId, ct)).WithKnowledgeAsync(knowledge, tenantId, ct);
        var texts = AiPromptCatalog.RuntimeTexts(await prompts.GetAsync(tenantId, ct));
        await foreach (var ev in Guarded(runtime.AskDataAsync(question, history.TakeLast(askData.HistoryTurns).ToList(), llm, texts, askData, ct), m => failed = m, ct))
        {
            switch (ev.Type)
            {
                case "status" when Str(ev.Data, "stage") is { } stage:
                    yield return new AiAskEvent("status", stage + "…");
                    break;
                case "node" when Str(ev.Data, "node") is { } node:
                    nodes.Add(node);
                    break;
                case "done":
                    done = ev.Data;
                    break;
                case "error":
                    failed = Str(ev.Data, "message") ?? "Ask Data reported an error.";
                    break;
            }
        }
        if (done is not { } d) { yield return Error(failed ?? "Ask Data ended without an answer. Check that the agent runtime is running."); yield break; }

        var steps = d.TryGetProperty("steps", out var st) && st.ValueKind == JsonValueKind.Array ? st.EnumerateArray().ToList() : [];
        var verified = !d.TryGetProperty("verified", out var v) || v.ValueKind != JsonValueKind.False;
        trace.Add(new("ask", Ms(started), $"Ask Data (route {Str(d, "route") ?? "sql"}): {string.Join(" → ", nodes)}"
            + (verified ? "" : " — the verifier did not accept the figures")));
        foreach (var s in steps)
            trace.Add(new("query", 0, $"{Str(s, "sql")}\n{(s.TryGetProperty("row_count", out var rc) ? rc.ToString() : "?")} rows"
                + (Rejected(s) ? " (rejected, not used for the answer)" : "")));

        // The query the answer was built from. steps also lists the rejected attempts (marked), so its last may not be it.
        var accepted = steps.Where(s => !Rejected(s)).ToList();
        var sql = Str(d, "sql") ?? (accepted.Count > 0 ? Str(accepted[^1], "sql") : null);
        if (!string.IsNullOrWhiteSpace(sql)) yield return new AiAskEvent("sql", new { sql, verified, queries = accepted.Count });
        if (Result(d) is { } result) yield return new AiAskEvent("result", result with { Labels = AskDataLabels(result.Columns, askData.Notes) });
        var answer = Str(d, "answer") ?? "";
        if (!verified) answer += "\n\n_The figures could not be verified: treat them as indicative._";
        yield return new AiAskEvent("answer", answer);
        // Next questions from what the database holds: follow-ups of an answer, or questions that work here when nothing was found.
        if (Strings(d, "follow_ups") is { Count: > 0 } next) yield return new AiAskEvent("followups", next);
        else if (Strings(d, "suggestions") is { Count: > 0 } other) yield return new AiAskEvent("suggestions", other);
        // After the answer is on screen: every save below is a round trip to the tenant database.
        await LogAskDataUsageAsync(d, tenantId, userId);

        // An Ask Data answer has SQL, not a spec: QuerySpecJson stays null, so likes, alerts and reports skip it.
        if (conv.Id == 0) await conversations.AddAsync(conv, ct);
        conv.ModifiedAt = DateTime.UtcNow;
        await conversations.AddMessageAsync(new AiChatMessage { ConversationId = conv.Id, Role = "user", Content = question }, ct);
        var assistant = new AiChatMessage { ConversationId = conv.Id, Role = "assistant", Content = answer };
        await conversations.AddMessageAsync(assistant, ct);
        await conversations.SaveAsync(ct);
        if (tracing) yield return new AiAskEvent("trace", trace);
        yield return new AiAskEvent("done", new { conversationId = conv.Id, sourceName = conv.SourceName, messageId = assistant.Id });
        // The trace is saved after "done": the panel does not wait for it. Fresh token: the request may be ending.
        try { await conversations.AddTraceAsync(new AiTrace { MessageId = assistant.Id, TraceJson = JsonSerializer.Serialize(trace, Json) }, CancellationToken.None); }
        catch (Exception ex) when (ex is not OperationCanceledException) { /* answer already saved */ }
    }

    /// <summary>Table headers in the tenant's business names (Terms & column names): a result column named like a noted
    /// column (its last part) shows that name, when every noted column of that name has the same one.</summary>
    private static IReadOnlyDictionary<string, string>? AskDataLabels(IReadOnlyList<string> columns, IReadOnlyList<AgentRuntimeColumnNote>? notes)
    {
        var names = (notes ?? []).Where(n => !string.IsNullOrWhiteSpace(n.DisplayName) && n.Column.Count(c => c == '.') == 2)
            .GroupBy(n => n.Column[(n.Column.LastIndexOf('.') + 1)..].Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Select(n => n.DisplayName!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() == 1)
            .ToDictionary(g => g.Key, g => g.First().DisplayName!.Trim(), StringComparer.OrdinalIgnoreCase);
        var labels = columns.Where(names.ContainsKey).ToDictionary(c => c, c => names[c]);
        return labels.Count > 0 ? labels : null;
    }

    private static List<string>? Strings(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
            : null;

    /// <summary>Earlier turns as the runtime expects them: {user, assistant} pairs, oldest first.</summary>
    private static List<Dictionary<string, string>> HistoryPairs(IReadOnlyList<AiChatMessage> history)
    {
        var pairs = new List<Dictionary<string, string>>();
        string? pending = null;
        foreach (var m in history)
        {
            if (m.Role == "user") pending = m.Content;
            else if (pending is not null) { pairs.Add(new() { ["user"] = pending, ["assistant"] = m.Content }); pending = null; }
        }
        return pairs;
    }

    /// <summary>The last query's rows as the panel's result table; null when no query ran (chitchat, clarify).</summary>
    private static AiQueryResult? Result(JsonElement done)
    {
        if (!done.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object
            || !data.TryGetProperty("columns", out var cols) || cols.ValueKind != JsonValueKind.Array) return null;
        var columns = cols.EnumerateArray().Select(x => x.GetString() ?? "").ToList();
        if (columns.Count == 0) return null;
        var rows = new List<Dictionary<string, object?>>();
        if (data.TryGetProperty("rows", out var rs) && rs.ValueKind == JsonValueKind.Array)
            foreach (var r in rs.EnumerateArray())
            {
                var cells = r.EnumerateArray().ToList();
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < columns.Count; i++) row[columns[i]] = i < cells.Count ? Value(cells[i]) : null;
                rows.Add(row);
            }
        var truncated = data.TryGetProperty("truncated", out var t) && t.ValueKind == JsonValueKind.True;
        return new AiQueryResult(columns, rows, rows.Count, rows.Count, truncated);
    }

    private static object? Value(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => e.ToString(),
    };

    /// <summary>One usage row per model call Ask Data made, so quotas and the AI activity page count them.</summary>
    private async Task LogAskDataUsageAsync(JsonElement done, long tenantId, long userId)
    {
        if (!done.TryGetProperty("usage", out var rows) || rows.ValueKind != JsonValueKind.Array) return;
        await usage.AddRangeAsync(rows.EnumerateArray().Select(u => new AiUsageLog
        {
            TenantId = tenantId, UserId = userId.ToString(), Purpose = "ask", Model = Str(u, "model") ?? "",
            PromptTokens = Int(u, "input"), CompletionTokens = Int(u, "output"), Succeeded = true,
        }).ToList(), CancellationToken.None);
    }

    /// <summary>A transport failure becomes a message instead of an exception (C# forbids yield inside try/catch).</summary>
    private static async IAsyncEnumerable<AgentRuntimeEvent> Guarded(IAsyncEnumerable<AgentRuntimeEvent> source, Action<string> onError,
        [EnumeratorCancellation] CancellationToken ct)
    {
        await using var e = source.GetAsyncEnumerator(ct);
        while (true)
        {
            bool more;
            try { more = await e.MoveNextAsync(); }
            catch (HttpRequestException ex) { onError("The Ask Data service is not reachable: " + ex.Message); yield break; }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { onError("Ask Data did not answer in time."); yield break; }
            catch (InvalidOperationException ex) { onError(ex.Message); yield break; }   // e.g. no Ask Data connection string
            catch (JsonException) { onError("Ask Data sent a reply that could not be read."); yield break; }
            if (!more) yield break;
            yield return e.Current;
        }
    }

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>An attempt the validator or verifier refused (Ask Data lists them after the accepted ones).</summary>
    private static bool Rejected(JsonElement step) =>
        step.ValueKind == JsonValueKind.Object && step.TryGetProperty("rejected", out var r) && r.ValueKind == JsonValueKind.True;

    private static int Int(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : 0;
}
