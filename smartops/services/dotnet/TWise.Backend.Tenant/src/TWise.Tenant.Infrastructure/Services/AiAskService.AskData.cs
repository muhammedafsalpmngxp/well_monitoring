using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
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
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(tenantId, ct)).WithKnowledgeAsync(knowledge, cache, tenantId, ct);
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
        // Each step the runtime ran, with its time and AI tokens (no prompt texts: they stay in the runtime).
        if (d.TryGetProperty("timeline", out var tl) && tl.ValueKind == JsonValueKind.Array)
            foreach (var (s, i) in tl.EnumerateArray().Select((s, i) => (s, i)))
            {
                var tokens = Int(s, "input") + Int(s, "output") > 0 ? $" · AI {Int(s, "input"):N0} in / {Int(s, "output"):N0} out tokens" : "";
                trace.Add(new($"Step {i + 1}", s.TryGetProperty("seconds", out var sec) && sec.TryGetDouble(out var x) ? (int)(x * 1000) : 0,
                    (Str(s, "node") ?? "") + tokens));
            }
        foreach (var s in steps)
            trace.Add(new("query", 0, $"{Str(s, "sql")}\n{(s.TryGetProperty("row_count", out var rc) ? rc.ToString() : "?")} rows"
                + (Rejected(s) ? " (rejected, not used for the answer)" : "")));
        // Every query refused on the way (the verifier's reason, a checker refusal, a database error), in order: shown in
        // the steps and kept as rows in core.AiTraces.rejections_json.
        var rejections = Rejections(d);
        foreach (var r in rejections)
            trace.Add(new($"rejected by {r.Stage}", 0, $"{r.Reason}\n{r.Sql}"));

        // The query the answer was built from. steps also lists the rejected attempts (marked), so its last may not be it.
        var accepted = steps.Where(s => !Rejected(s)).ToList();
        var sql = Str(d, "sql") ?? (accepted.Count > 0 ? Str(accepted[^1], "sql") : null);
        if (!string.IsNullOrWhiteSpace(sql)) yield return new AiAskEvent("sql", new { sql, verified, queries = accepted.Count });
        if (Result(d) is { } result)
        {
            yield return new AiAskEvent("result", result with { Labels = AskDataLabels(result.Columns, askData.Notes) });
            // A chart for the panel: the runtime's when the question asked for one, else read from the answer's groups.
            if (AskDataChart(d, sql, result, question) is { } chart) yield return new AiAskEvent("chartspec", chart);
            // Highest and lowest group, shares, ties and blanks, worked out in code from the answer's own rows.
            if (AskDataInsights.Spec(sql, result) is { } shape && Insights.Find(shape, result) is { Count: > 0 } findings)
                yield return new AiAskEvent("insights", findings);
        }
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
        try
        {
            await conversations.AddTraceAsync(new AiTrace
            {
                MessageId = assistant.Id, TraceJson = JsonSerializer.Serialize(trace, Json),
                RejectionsJson = rejections.Count > 0 ? JsonSerializer.Serialize(rejections, Json) : null,
            }, CancellationToken.None);
        }
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

    /// <summary>The insight report of an Ask Data answer: its SQL (from the saved steps) runs again, checked like an export,
    /// and the report is worked out from those rows.</summary>
    private async Task<AiInsightReportDto> AskDataReportAsync(AiConversation conv, AiChatMessage msg, long tenantId, long userId, CancellationToken ct)
    {
        var sql = await AnsweredSqlAsync(msg.Id, ct)
            ?? throw new InvalidOperationException("This answer has no query to report on (an answer's steps are kept 30 days).");
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(tenantId, ct)).WithKnowledgeAsync(knowledge, cache, tenantId, ct);
        var result = Result(await runtime.AskDataRowsAsync(sql, askData, ct))
            ?? throw new InvalidOperationException(NeedsGroups);
        var shape = AskDataInsights.Spec(sql, result) ?? throw new InvalidOperationException(NeedsGroups);
        return await ReportFromAsync(conv, msg, shape, result with { Labels = AskDataLabels(result.Columns, askData.Notes) }, sql, tenantId, userId, ct);
    }

    public async Task<AskDataViewDto?> SaveAskDataViewAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Chart, ct))
            throw new InvalidOperationException("Charts from answers are not enabled for your role. An admin can grant them under Settings → AI Features.");
        var (msg, conv) = await OwnedAssistantMessageAsync(messageId, tenantId, userId, ct);
        if (msg is null || conv is null || conv.SourceType != AskDataSource) return null;
        var sql = await AnsweredSqlAsync(msg.Id, ct)
            ?? throw new InvalidOperationException("This answer has no query to chart (an answer's steps are kept 30 days).");
        // Checked again like an export (it must still be allowed) and run once, for its columns and chart.
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(tenantId, ct)).WithKnowledgeAsync(knowledge, cache, tenantId, ct);
        var result = Result(await runtime.AskDataRowsAsync(sql, askData, ct))
            ?? throw new InvalidOperationException("This answer has no rows to chart.");
        var question = (await conversations.GetMessagesAsync(conv.Id, ct)).LastOrDefault(m => m.Role == "user" && m.Id < msg.Id)?.Content ?? conv.Title;
        var shape = AskDataInsights.Spec(sql, result, minRows: 2);
        var chartType = AskDataInsights.BuilderType(AskDataInsights.Chart(sql, result, question));

        // One view per answer: its name starts with the answer's id, so a second click reuses it.
        var prefix = $"Ask Data #{msg.Id}";
        var saved = (await views.GetAllAsync(tenantId, "view", ct)).FirstOrDefault(v => v.ViewName == prefix || v.ViewName.StartsWith(prefix + ":", StringComparison.Ordinal));
        if (saved is null)
        {
            var connection = await AskDataConnectionAsync(tenantId, ct)
                ?? throw new InvalidOperationException("No data source points at the Ask Data database. An admin can add it under Settings → Data Sources.");
            var name = $"{prefix}: {question}";
            var tables = System.Text.RegularExpressions.Regex.Matches(sql, @"(?:from|join)\s+\[?(\w+)\]?\.\[?(\w+)\]?", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                .Select(m => $"{m.Groups[1].Value}.{m.Groups[2].Value}").Distinct(StringComparer.OrdinalIgnoreCase);
            var view = await views.CreateAsync(new CreateDatabaseViewRequest(connection, name.Length > 128 ? name[..128] : name,
                $"Saved from Ask your data: {question}"[..Math.Min(500, 26 + question.Length)], false, "[]", "{}", "[]", null, null, sql, sql,
                string.Join(",", tables), result.Columns.Count), userId, tenantId, ct);
            return new AskDataViewDto(view.Id, view.ViewName, chartType, shape?.GroupBy?[0], shape?.Measures?[0].Column);
        }
        return new AskDataViewDto(saved.Id, saved.ViewName, chartType, shape?.GroupBy?[0], shape?.Measures?[0].Column);
    }

    /// <summary>The tenant's data source for the Ask Data database: same server (any port) and database name.</summary>
    private async Task<long?> AskDataConnectionAsync(long tenantId, CancellationToken ct)
    {
        var (server, database) = runtime.AskDataDatabase();
        static string Host(string s) => s.Replace("tcp:", "", StringComparison.OrdinalIgnoreCase).Split(',')[0].Trim();
        return (await connections.GetAllAsync(tenantId, ct))
            .FirstOrDefault(c => c.IsActive && !c.IsDeleted && string.Equals(Host(c.Server), server, StringComparison.OrdinalIgnoreCase)
                && string.Equals(c.DatabaseName, database, StringComparison.OrdinalIgnoreCase))?.Id;
    }

    /// <summary>The runtime's chart (only when the question asked for one), else one read from the answer's groups.</summary>
    private static AskDataChartDto? AskDataChart(JsonElement done, string? sql, AiQueryResult result, string question)
    {
        if (done.TryGetProperty("chart", out var c) && c.ValueKind == JsonValueKind.Object && Str(c, "type") is "bar" or "line" or "donut"
            && c.TryGetProperty("labels", out var l) && l.ValueKind == JsonValueKind.Array && c.TryGetProperty("series", out var s) && s.ValueKind == JsonValueKind.Array)
            return new AskDataChartDto(Str(c, "type")!, Str(c, "title") ?? question, l.EnumerateArray().Select(x => x.ToString()).ToList(),
                s.EnumerateArray().Select(x => new AskDataChartSeriesDto(Str(x, "name") ?? "",
                    x.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Array ? d.EnumerateArray().Select(v => v.TryGetDouble(out var n) ? n : 0).ToList() : [])).ToList(),
                Str(c, "x_axis"), Str(c, "y_axis"));
        return AskDataInsights.Chart(sql, result, question);
    }

    public Task<string?> AskDataSqlAsync(long messageId, CancellationToken ct) => AnsweredSqlAsync(messageId, ct);

    public async Task<(AiQuerySpec Spec, AiQueryResult Result)> RunAskDataAsync(string sql, long tenantId, CancellationToken ct)
    {
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(tenantId, ct)).WithKnowledgeAsync(knowledge, cache, tenantId, ct);
        var result = Result(await runtime.AskDataRowsAsync(sql, askData, ct)) ?? throw new InvalidOperationException("The watched query returned no table.");
        return (AskDataInsights.WatchSpec(sql, result), result);
    }

    /// <summary>The SQL an Ask Data answer was built from, from its saved steps (kept 30 days); null when gone.</summary>
    private async Task<string?> AnsweredSqlAsync(long messageId, CancellationToken ct)
    {
        var saved = await conversations.GetTraceAsync(messageId, ct);
        return AskDataInsights.AcceptedSql(saved is null ? null : JsonSerializer.Deserialize<List<AiTraceStep>>(saved.TraceJson, Json));
    }

    /// <summary>A liked Ask Data answer is also read for column notes an admin may approve (rules learned from good
    /// answers), over the columns of the tables its SQL reads.</summary>
    private async Task QueueAskDataExtractionAsync(AiConversation conv, string question, string sql, long tenantId, long userId, CancellationToken ct)
    {
        var tables = System.Text.RegularExpressions.Regex.Matches(sql, @"(?:from|join)\s+\[?(\w+)\]?\.\[?(\w+)\]?", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
            .Select(m => $"{m.Groups[1].Value}.{m.Groups[2].Value}").ToHashSet(StringComparer.OrdinalIgnoreCase);
        using var scope = scopes.CreateScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<IAskDataCatalogReader>().ReadAsync(ct);
        var columns = catalog.Schemas.SelectMany(s => s.Tables.Where(t => tables.Contains($"{s.Name}.{t.Name}")).SelectMany(t => t.Columns.Select(c => $"{s.Name}.{t.Name}.{c}"))).ToList();
        if (columns.Count == 0) return;
        var notes = await knowledge.GetNotesAsync(tenantId, AiSources.AskData, 0, ct);
        QueueExtraction(tenantId, userId, AiSources.AskData, 0, AskDataName, question, sql, columns, notes, requireColumn: true);
    }

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
    /// <summary>The queries the runtime refused this turn, in order (it caps them at 20): stage is validator (refused before
    /// running), database (SQL Server error) or verifier (the figures did not answer the question).</summary>
    internal static IReadOnlyList<AskDataRejection> Rejections(JsonElement done) =>
        done.TryGetProperty("rejections", out var rs) && rs.ValueKind == JsonValueKind.Array
            ? rs.EnumerateArray().Where(r => r.ValueKind == JsonValueKind.Object)
                .Select(r => new AskDataRejection(Str(r, "stage") ?? "", Str(r, "sql") ?? "", Str(r, "reason") ?? "", Str(r, "sub_question")))
                .ToList()
            : [];

    private static bool Rejected(JsonElement step) =>
        step.ValueKind == JsonValueKind.Object && step.TryGetProperty("rejected", out var r) && r.ValueKind == JsonValueKind.True;

    private static int Int(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : 0;
}
