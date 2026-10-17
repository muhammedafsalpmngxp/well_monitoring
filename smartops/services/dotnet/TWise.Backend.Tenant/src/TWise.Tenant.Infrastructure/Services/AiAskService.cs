using System.Diagnostics;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Caching.Memory;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Ask-your-data pipeline. Rows come from the same loaders the Chart Builder uses (filtered chart
/// data for views, dataset data for imports), the model turns the question into an AiQuerySpec,
/// QuerySpecEngine validates and runs it in memory, and a second streamed call phrases the answer.
/// The model never sees connection details and never writes SQL.
/// </summary>
public sealed partial class AiAskService(
    IAiService ai,
    IAiConversationRepository conversations,
    IDatabaseViewService views,
    IImportedDatasetService imports,
    ISourceService sources,
    IAiKnowledgeRepository knowledge,
    IAiSettingsRepository settings,
    IAiFeatureRoleRepository grants,
    ICurrentUserService currentUser,
    IServiceScopeFactory scopes,
    IMemoryCache cache,
    IAiViewQueryRunner viewQueries,
    IAgentRuntimeClient runtime,
    IAiUsageRepository usage,
    IAiPromptStore prompts) : IAiAskService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int HistoryTurns = 6;
    private const int AnswerSampleRows = 30;
    private const int SummaryMaxRows = 200;
    private const int DashboardMaxCharts = 12;
    private const int DashboardRowsPerChart = 60;
    private static readonly TimeSpan SummaryCacheTtl = TimeSpan.FromHours(24);
    private const int MaxExamples = 4;

    public async Task<IReadOnlyList<AiDatasetDto>> ListDatasetsAsync(long tenantId, long userId, CancellationToken ct)
    {
        var v = (await views.GetAllAsync(tenantId, "view", ct)).Select(x => new AiDatasetDto("view", x.Id, x.ViewName, x.Description, (int?)x.RowCount));
        var i = (await imports.GetAllAsync(tenantId, userId, ct)).Where(x => x.Status == "completed").Select(x => new AiDatasetDto("import", x.Id, x.DatasetName, x.FileName, x.RowCount));
        return v.Concat(i).OrderBy(d => d.Name).ToList();
    }

    public async IAsyncEnumerable<AiAskEvent> AskAsync(AiAskRequest request, long tenantId, long userId, [EnumeratorCancellation] CancellationToken ct)
    {
        var question = (request.Question ?? "").Trim();
        if (question.Length is 0 or > 2000) { yield return Error("Ask a question of up to 2000 characters."); yield break; }
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Ask, ct)) { yield return Error("Ask your data is not enabled for your role. An admin can grant it under Settings → AI."); yield break; }

        // 1. Conversation
        AiConversation? conv;
        if (request.ConversationId is { } cid)
        {
            conv = await conversations.GetAsync(cid, tenantId, userId.ToString(), ct);
            if (conv is null) { yield return Error("Conversation not found."); yield break; }
        }
        else if (request.SourceType is null or AskDataSource)
        {
            // No dataset chosen: the question goes to Ask Data, over the whole Ask Data database.
            conv = new AiConversation { TenantId = tenantId, UserId = userId.ToString(), SourceType = AskDataSource, SourceId = 0, SourceName = AskDataName, Title = question.Length > 120 ? question[..120] : question };
        }
        else
        {
            if (request.SourceType is not ("view" or "import") || request.SourceId is null) { yield return Error("Choose a dataset first."); yield break; }
            conv = new AiConversation { TenantId = tenantId, UserId = userId.ToString(), SourceType = request.SourceType, SourceId = request.SourceId.Value, Title = question.Length > 120 ? question[..120] : question };
        }

        // Every step is traced (prompts, replies, timings) and kept with the answer; shown only with the Trace feature.
        var tracing = await FeatureOnAsync(tenantId, AiFeatureCatalog.Trace, ct);

        if (conv.SourceType == AskDataSource)
        {
            await foreach (var ev in AskDataAsync(conv, question, tracing, tenantId, userId, ct)) yield return ev;
            yield break;
        }
        var trace = new List<AiTraceStep>();
        var started = Stopwatch.GetTimestamp();

        // 2. Rows
        yield return new AiAskEvent("status", "Reading the dataset…");
        TableDataDto? data = null;
        string? loadError = null;
        var cached = false;
        try { (data, conv.SourceName, cached) = await LoadCachedAsync(conv.SourceType, conv.SourceId, tenantId, ct); }
        catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException) { loadError = ex.Message; }
        if (loadError is not null) { yield return Error(loadError); yield break; }
        if (data is null || data.Columns.Count == 0) { yield return Error("The dataset has no columns or could not be loaded."); yield break; }
        var truncated = IsTruncated(conv.SourceType, data);
        trace.Add(new("load", Ms(started), $"{data.Columns.Count} columns, {data.Rows.Count} rows {(cached ? "from the 10-minute cache" : "loaded")}{(truncated ? " (first rows only; queries run in the database)" : "")}"));

        // 3. Spec, with one auto-fix round trip on a bad spec
        yield return new AiAskEvent("status", "Working out the query…");
        var step = Stopwatch.GetTimestamp();
        var history = conv.Id == 0 ? [] : await conversations.GetMessagesAsync(conv.Id, ct);
        var notes = await knowledge.GetNotesAsync(tenantId, conv.SourceType, conv.SourceId, ct);
        var related = DatasetRelations.Describe(await knowledge.GetRelationsAsync(tenantId, ct), conv.SourceType, conv.SourceId);
        var allExamples = await knowledge.GetExamplesAsync(tenantId, conv.SourceType, conv.SourceId, ct);
        var examples = ExamplePicker.Pick(allExamples, question, MaxExamples);
        var metrics = await knowledge.GetMetricsAsync(tenantId, conv.SourceType, conv.SourceId, ct);
        var profiles = await ProfilesAsync(tenantId, conv.SourceType, conv.SourceId, data, conv.SourceType == "view" && truncated, ct);
        // Business terms first: the words they explain are not searched as values.
        var terms = await knowledge.GetTermsAsync(tenantId, conv.SourceType, conv.SourceId, ct);
        var usedTerms = BusinessTerms.Used(terms, question);
        var matched = await MatchValuesAsync(tenantId, conv.SourceType, conv.SourceId, BusinessTerms.Strip(usedTerms, question), data, profiles, conv.SourceType == "view" && truncated, ct);
        var valueBlock = BusinessTerms.Describe(terms, usedTerms) + matched;
        // The review sees only the terms this question used: listing every term made it demand them all.
        var reviewHints = BusinessTerms.Describe(usedTerms, usedTerms) + matched;
        var prompts = await PromptsAsync(tenantId, conv.SourceType, conv.SourceId, ct);
        var messages = BuildSpecMessages(conv.SourceName, data, question, history, notes, examples, metrics, conv.SourceType == "view" && truncated, profiles, valueBlock + related, AiPrompts.Text(AiPrompts.AskRules, prompts));
        trace.Add(new("context", Ms(step), $"{profiles.Count} column profiles, {examples.Count} examples, {usedTerms.Count} business terms used, {notes.Count} notes, {metrics.Count} metrics, {history.Count} earlier messages"));
        AiQuerySpec? spec = null;
        AiQueryResult? result = null;
        string? lastError = null;
        // An option picked from a clarification is run exactly as offered; no model call for the query.
        if (request.Spec is not null)
        {
            try
            {
                spec = QuerySpecEngine.Validate(request.Spec, data.Columns);
                result = await RunQueryAsync(conv, data, truncated, spec, tenantId, trace, ct);
            }
            catch (InvalidOperationException ex) { lastError = ex.Message; trace.Add(new("rejected", 0, ex.Message)); }
        }
        // Up to two corrections: a spec that fails validation, or a query the database rejects.
        for (var attempt = 0; attempt < 3 && result is null && request.Spec is null; attempt++)
        {
            if (lastError is not null)
                messages.Add(new AiMessage("user", $"That spec failed: {lastError}\nReturn a corrected JSON spec only."));
            string raw = "";
            string? aiError = null;
            step = Stopwatch.GetTimestamp();
            var sent = messages.ToList();
            try { raw = (await ai.CompleteAsync(tenantId, userId.ToString(), "ask", messages, ct)).Content; }
            catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException) { aiError = ex.Message; }
            trace.Add(new("ask", Ms(step), aiError ?? (attempt == 0 ? "Question to query" : $"Correction {attempt}"), sent, raw));
            if (aiError is not null)
            {
                if (tracing) yield return new AiAskEvent("trace", trace);
                yield return Error(aiError);
                yield break;
            }
            messages.Add(new AiMessage("assistant", raw));
            // Nothing in the dataset means what was asked: say so plainly, with questions that do work here.
            if (attempt == 0 && Clarification.Missing(raw) is { } missing)
            {
                if (tracing) yield return new AiAskEvent("trace", trace);
                yield return new AiAskEvent("suggestions", AskHelp.Suggestions(question, allExamples, profiles));
                yield return Error(missing);
                yield break;
            }
            // Only the first reply may ask the user to choose; a correction must be a spec.
            var clarify = attempt == 0 ? Clarification.TryParse(raw, data.Columns) : null;
            if (clarify is { Options.Count: >= 2 })
            {
                if (tracing) yield return new AiAskEvent("trace", trace);
                yield return new AiAskEvent("clarify", clarify);
                yield break;
            }
            try
            {
                spec = clarify is { Options.Count: 1 }
                    ? clarify.Options[0].Spec
                    : QuerySpecEngine.Validate(ParseSpec(raw), data.Columns);
                result = await RunQueryAsync(conv, data, truncated, spec, tenantId, trace, ct);
            }
            catch (Exception ex) when (ex is InvalidOperationException or JsonException) { lastError = ex.Message; trace.Add(new("rejected", 0, ex.Message)); }
        }
        if (result is null || spec is null)
        {
            if (tracing) yield return new AiAskEvent("trace", trace);
            // A plain reason and questions that work here, instead of the validator's or database's wording.
            yield return new AiAskEvent("suggestions", AskHelp.Suggestions(question, allExamples, profiles));
            yield return Error(AskHelp.Friendly(lastError, data.Columns));
            yield break;
        }
        yield return new AiAskEvent("spec", spec);
        result = result with { Labels = ResultLabels(spec, result, DisplayNames(notes)) };
        yield return new AiAskEvent("result", result);
        if (AskHelp.FoundNothing(spec, result)) yield return new AiAskEvent("suggestions", AskHelp.Suggestions(question, allExamples, profiles));
        // Trend, top/bottom, share and outliers worked out in code, so the answer's numbers are right.
        var insights = Insights.Find(spec, result);
        if (insights.Count > 0) yield return new AiAskEvent("insights", insights);

        // 4. Streamed answer
        var answer = new StringBuilder();
        var answerMessages = BuildAnswerMessages(question, spec, result, insights, AiPrompts.Text(AiPrompts.Answer, prompts));
        if (result.Labels is { Count: > 0 })
            answerMessages[^1] = answerMessages[^1] with { Content = answerMessages[^1].Content + "\nColumn names as users know them (use these words in the answer): " + string.Join(", ", result.Labels.Select(kv => $"{kv.Key} = \"{kv.Value}\"")) };
        step = Stopwatch.GetTimestamp();
        await foreach (var delta in Stream(tenantId, userId, "answer", answerMessages, ct))
        {
            if (delta.Error is not null)
            {
                trace.Add(new("answer", Ms(step), delta.Error, answerMessages, answer.ToString()));
                if (tracing) yield return new AiAskEvent("trace", trace);
                yield return Error(delta.Error);
                yield break;
            }
            answer.Append(delta.Text);
            yield return new AiAskEvent("answer", delta.Text);
        }
        trace.Add(new("answer", Ms(step), $"Total {Ms(started)} ms", answerMessages, answer.ToString()));

        // 5. Persist
        if (conv.Id == 0) await conversations.AddAsync(conv, ct);
        conv.ModifiedAt = DateTime.UtcNow;
        await conversations.AddMessageAsync(new AiChatMessage { ConversationId = conv.Id, Role = "user", Content = question }, ct);
        var assistantMessage = new AiChatMessage { ConversationId = conv.Id, Role = "assistant", Content = answer.ToString(), QuerySpecJson = JsonSerializer.Serialize(spec, Json) };
        await conversations.AddMessageAsync(assistantMessage, ct);
        await conversations.SaveAsync(ct);
        // A trace is a debugging aid: failing to keep it must not fail the answer.
        try { await conversations.AddTraceAsync(new AiTrace { MessageId = assistantMessage.Id, TraceJson = JsonSerializer.Serialize(trace, Json) }, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { /* answer already saved */ }
        if (tracing) yield return new AiAskEvent("trace", trace);
        yield return new AiAskEvent("done", new { conversationId = conv.Id, sourceName = conv.SourceName, messageId = assistantMessage.Id });

        // 6. Learn in the background: note proposals for an admin, and this answer as a reviewed example.
        if (await FeatureOnAsync(tenantId, AiFeatureCatalog.Learning, ct))
        {
            QueueExtraction(tenantId, userId, conv.SourceType, conv.SourceId, conv.SourceName, question, spec, data.Columns, notes);
            // An answer that found nothing (no rows, or a total of 0) is a poor example for later questions.
            if (!AskHelp.FoundNothing(spec, result))
                QueueMemory(tenantId, userId, conv.SourceType, conv.SourceId, conv.SourceName, assistantMessage.Id, question, spec, result, answer.ToString(), data.Columns, reviewHints);
        }
    }

    public async IAsyncEnumerable<AiAskEvent> SummarizeAsync(AiSummaryRequest request, long tenantId, long userId, [EnumeratorCancellation] CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Summary, ct)) { yield return Error("Explain charts is not enabled for your role. An admin can grant it under Settings → AI Features."); yield break; }
        if (request.Columns is not { Count: > 0 } || request.Rows is not { Count: > 0 }) { yield return Error("There is no chart data to explain."); yield break; }

        var rows = request.Rows.Take(SummaryMaxRows).ToList();
        var note = request.Rows.Count > SummaryMaxRows ? $" Only the first {SummaryMaxRows} of {request.Rows.Count} rows are shown." : "";
        var system = AiPrompts.Text(AiPrompts.ChartSummary, await PromptsAsync(tenantId, ct));
        var messages = new List<AiMessage>
        {
            new("system", system),
            new("user", $"Chart: {request.Title}\n{(string.IsNullOrWhiteSpace(request.Context) ? "" : "Context: " + request.Context.Trim() + "\n")}Columns: {string.Join(", ", request.Columns)}{note}\nData: {JsonSerializer.Serialize(rows, Json)}"),
        };
        await foreach (var ev in CachedStream(CacheKey("chart", tenantId, new { request.Title, request.Context, request.Columns, rows, system }), request.Force, "summary", messages, tenantId, userId, ct))
            yield return ev;
    }

    public async IAsyncEnumerable<AiAskEvent> SummarizeDashboardAsync(AiDashboardSummaryRequest request, long tenantId, long userId, [EnumeratorCancellation] CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Summary, ct)) { yield return Error("Explain charts is not enabled for your role. An admin can grant it under Settings → AI Features."); yield break; }
        var charts = (request.Charts ?? []).Where(c => c.Columns is { Count: > 0 } && c.Rows is { Count: > 0 }).Take(DashboardMaxCharts)
            .Select(c => new { c.Title, c.Columns, Rows = c.Rows.Take(DashboardRowsPerChart).ToList() }).ToList();
        if (charts.Count == 0) { yield return Error("There is no chart data to explain yet."); yield break; }

        var body = new StringBuilder();
        foreach (var c in charts)
            body.Append("Chart \"").Append(c.Title).Append("\" (").Append(string.Join(", ", c.Columns)).Append("): ").Append(JsonSerializer.Serialize(c.Rows, Json)).Append('\n');
        var system = AiPrompts.Text(AiPrompts.DashboardSummary, await PromptsAsync(tenantId, ct));
        var messages = new List<AiMessage>
        {
            new("system", system),
            new("user", $"Dashboard: {request.Title}\n{body}"),
        };
        await foreach (var ev in CachedStream(CacheKey("dashboard", tenantId, new { request.Title, charts, system }), request.Force, "summary", messages, tenantId, userId, ct))
            yield return ev;
    }

    /// <summary>Same payload → same text for 24h (per tenant); Force bypasses and overwrites. Cached replies arrive as a single answer event.</summary>
    private async IAsyncEnumerable<AiAskEvent> CachedStream(string key, bool force, string purpose, List<AiMessage> messages, long tenantId, long userId, [EnumeratorCancellation] CancellationToken ct)
    {
        if (!force && cache.TryGetValue(key, out string? cached) && cached is not null)
        {
            yield return new AiAskEvent("answer", cached);
            yield return new AiAskEvent("done", new { cached = true });
            yield break;
        }
        var text = new StringBuilder();
        await foreach (var delta in Stream(tenantId, userId, purpose, messages, ct))
        {
            if (delta.Error is not null) { yield return Error(delta.Error); yield break; }
            text.Append(delta.Text);
            yield return new AiAskEvent("answer", delta.Text);
        }
        if (text.Length > 0) cache.Set(key, text.ToString(), SummaryCacheTtl);
        yield return new AiAskEvent("done", new { cached = false });
    }

    private static string CacheKey(string kind, long tenantId, object payload)
    {
        var hash = SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(payload, Json));
        return $"ai:{kind}:{tenantId}:{Convert.ToHexString(hash)}";
    }

    public async Task<IReadOnlyList<AiFilterSuggestion>> SuggestFiltersAsync(AiFilterSuggestRequest request, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Filters, ct)) throw new InvalidOperationException("Suggest filters is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var charts = (request.Charts ?? []).Where(c => c.Columns is { Count: > 0 }).Take(20).ToList();
        if (charts.Count == 0) throw new InvalidOperationException("Place at least one chart with data first.");

        var sb = new StringBuilder();
        foreach (var c in charts)
        {
            sb.Append("Chart \"").Append(c.Title).Append("\" (source ").Append(c.SourceTable).Append("):\n");
            foreach (var (col, p) in c.Columns.Take(60))
                sb.Append("  - ").Append(col).Append(" | distinct ").Append(p.Distinct).Append(" | e.g. ").Append(string.Join(", ", p.Samples.Take(4).Select(s => s.Length > 25 ? s[..25] : s))).Append('\n');
        }
        var already = request.AlreadyAdded is { Count: > 0 } ? "Already added (do not repeat): " + string.Join(", ", request.AlreadyAdded) + "\n" : "";
        var messages = new List<AiMessage>
        {
            new("system",
                AiPrompts.Text(AiPrompts.Filters, await PromptsAsync(tenantId, ct)) + " Return JSON only: an array of at most 6 objects " +
                "{\"sourceTable\":\"...\",\"sourceColumn\":\"...\",\"label\":\"short display name\",\"reason\":\"one short sentence\"}. " +
                "sourceTable and sourceColumn must be copied exactly from the input."),
            new("user", $"Dashboard: {request.DashboardName}\n{already}{sb}"),
        };
        var raw = (await ai.CompleteAsync(tenantId, userId.ToString(), "filters", messages, ct)).Content;

        List<AiFilterSuggestion> parsed;
        try
        {
            var s = raw.Trim();
            if (s.StartsWith("```")) { s = s[(s.IndexOf('\n') + 1)..]; var end = s.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) s = s[..end]; }
            var start = s.IndexOf('['); var stop = s.LastIndexOf(']');
            parsed = JsonSerializer.Deserialize<List<AiFilterSuggestion>>(s[start..(stop + 1)], Json) ?? [];
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try again."); }

        // Keep only suggestions that name a real column of a real source; the model may invent.
        var valid = new List<AiFilterSuggestion>();
        foreach (var sug in parsed)
        {
            var chart = charts.FirstOrDefault(c => string.Equals(c.SourceTable, sug.SourceTable, StringComparison.OrdinalIgnoreCase));
            var col = chart?.Columns.Keys.FirstOrDefault(k => string.Equals(k, sug.SourceColumn, StringComparison.OrdinalIgnoreCase));
            if (chart is null || col is null || valid.Any(v => v.SourceTable == chart.SourceTable && v.SourceColumn == col)) continue;
            valid.Add(new AiFilterSuggestion(chart.SourceTable, col, string.IsNullOrWhiteSpace(sug.Label) ? col : sug.Label.Trim(), sug.Reason?.Trim() ?? ""));
            if (valid.Count == 6) break;
        }
        return valid;
    }

    private static readonly string[] YFunctions = ["Count (F)", "Count Distinct (F)", "Sum (F)", "Average (F)", "Min (F)", "Max (F)"];
    private static readonly string[] LimitModes = ["all", "top", "bottom"];

    public async Task<AiChartEditResponse> EditChartAsync(AiChartEditRequest request, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Edit, ct)) throw new InvalidOperationException("Edit chart by chat is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var instruction = (request.Instruction ?? "").Trim();
        if (instruction.Length is 0 or > 500) throw new InvalidOperationException("Type an instruction of up to 500 characters.");
        if (request.Columns is not { Count: > 0 }) throw new InvalidOperationException("Load a data source first.");

        var messages = new List<AiMessage>
        {
            new("system",
                AiPrompts.Text(AiPrompts.ChartEdit, await PromptsAsync(tenantId, ct)) + " Reply with JSON only: " +
                "{\"patch\":{...only the fields to change...},\"message\":\"one short sentence\"}. " +
                "Allowed patch fields: chartType, xAxis, yAxis, yAggColumn, title, xAxisTitle, yAxisTitle, showLegend, showDataLabels, " +
                "showAxisTitle, includeDataTable, limitCategory (all|top|bottom), topN, bottomN, groupRestAsOthers. " +
                "xAxis and yAggColumn must be column names from the list. yAxis is the aggregation function, one of: " + string.Join(", ", YFunctions) + ". " +
                "chartType must be one of the allowed chart types."),
            new("user", $"Instruction: {instruction}\nCurrent: {JsonSerializer.Serialize(request.Current, Json)}\nColumns: {string.Join(", ", request.Columns)}\nAllowed chart types: {string.Join(", ", request.ChartTypes ?? [])}"),
        };
        var raw = (await ai.CompleteAsync(tenantId, userId.ToString(), "edit", messages, ct)).Content;

        AiChartEditResponse? parsed;
        try
        {
            var s = raw.Trim();
            if (s.StartsWith("```")) { s = s[(s.IndexOf('\n') + 1)..]; var end = s.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) s = s[..end]; }
            var start = s.IndexOf('{'); var stop = s.LastIndexOf('}');
            parsed = JsonSerializer.Deserialize<AiChartEditResponse>(s[start..(stop + 1)], Json);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try rephrasing."); }
        if (parsed is null) throw new InvalidOperationException("The AI returned nothing. Try rephrasing.");

        // Validate every field against what the builder actually offers; drop anything else silently.
        var p = parsed.Patch ?? new AiChartState(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        string? Col(string? c) => c is null ? null : request.Columns.FirstOrDefault(k => string.Equals(k, c.Trim(), StringComparison.OrdinalIgnoreCase));
        string? Pick(string? v, IEnumerable<string> allowed) => v is null ? null : allowed.FirstOrDefault(a => string.Equals(a, v.Trim(), StringComparison.OrdinalIgnoreCase));
        var patch = new AiChartState(
            Pick(p.ChartType, request.ChartTypes ?? []), Col(p.XAxis), Pick(p.YAxis, YFunctions), Col(p.YAggColumn),
            Trim(p.Title, 120), Trim(p.XAxisTitle, 60), Trim(p.YAxisTitle, 60),
            p.ShowLegend, p.ShowDataLabels, p.ShowAxisTitle, p.IncludeDataTable,
            Pick(p.LimitCategory, LimitModes), p.TopN is > 0 and <= 500 ? p.TopN : null, p.BottomN is > 0 and <= 500 ? p.BottomN : null, p.GroupRestAsOthers);
        // A refusal often echoes the current values; keep only real changes so the builder does nothing on "no".
        var cur = request.Current;
        patch = patch with
        {
            ChartType = patch.ChartType == cur.ChartType ? null : patch.ChartType, XAxis = patch.XAxis == cur.XAxis ? null : patch.XAxis,
            YAxis = patch.YAxis == cur.YAxis ? null : patch.YAxis, YAggColumn = patch.YAggColumn == cur.YAggColumn ? null : patch.YAggColumn,
            Title = patch.Title == cur.Title ? null : patch.Title,
        };
        return new AiChartEditResponse(patch, Trim(parsed.Message, 300) ?? "Done.");
    }

    public async Task<IReadOnlyList<AiChartSuggestion>> SuggestChartsAsync(AiChartSuggestRequest request, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Recommend, ct)) throw new InvalidOperationException("Recommend charts is not enabled for your role. An admin can grant it under Settings → AI Features.");
        return (await SuggestCoreAsync(request.SourceName, request.RowCount, request.Columns, request.ChartTypes, 3, null, "recommend", tenantId, userId, ct)).Charts;
    }

    public async Task<AiDashboardSuggestion> SuggestDashboardAsync(AiDashboardSuggestRequest request, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Dashboard, ct)) throw new InvalidOperationException("Dashboard from a prompt is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var goal = (request.Goal ?? "").Trim();
        if (goal.Length is 0 or > 300) throw new InvalidOperationException("Describe the dashboard in up to 300 characters.");
        return await SuggestCoreAsync(request.SourceName, request.RowCount, request.Columns, request.ChartTypes, 6, goal, "dashboard", tenantId, userId, ct);
    }

    /// <summary>Shared by Recommend (3 charts, no goal) and Dashboard from a prompt (up to 6 charts, a goal and a title).</summary>
    private async Task<AiDashboardSuggestion> SuggestCoreAsync(string sourceName, int rowCount, IReadOnlyDictionary<string, AiColumnProfile> columnsIn, IReadOnlyList<string>? chartTypes,
        int count, string? goal, string purpose, long tenantId, long userId, CancellationToken ct)
    {
        if (columnsIn is not { Count: > 0 }) throw new InvalidOperationException("Load a data source first.");
        var types = chartTypes is { Count: > 0 } ? chartTypes : ["bar", "line", "pie", "table"];
        var request = new { SourceName = sourceName, RowCount = rowCount, Columns = columnsIn };

        var profile = new StringBuilder();
        foreach (var (col, p) in request.Columns.Take(60))
            profile.Append("- ").Append(col).Append(" | distinct ").Append(p.Distinct).Append(" | e.g. ").Append(string.Join(", ", p.Samples.Take(4).Select(s => s.Length > 25 ? s[..25] : s))).Append('\n');

        var messages = new List<AiMessage>
        {
            new("system",
                (goal is null
                    ? "You propose charts for a dataset in a BI tool. Reply with JSON only: an array of exactly 3 objects "
                    : $"You design a first dashboard for a dataset in a BI tool, for this goal: \"{goal}\". Reply with JSON only: {{\"title\":\"short dashboard title\",\"charts\":[...]}} where charts is an array of up to {count} objects ") +
                "{\"patch\":{\"chartType\":\"...\",\"xAxis\":\"column\",\"yAxis\":\"function\",\"yAggColumn\":\"column or null\",\"title\":\"short title\",\"limitCategory\":\"all|top\",\"topN\":10},\"reason\":\"one short sentence\"}. " +
                "xAxis is a low-cardinality or date column; yAggColumn is a numeric column (null for a plain count). yAxis is one of: " + string.Join(", ", YFunctions) + ". " +
                "chartType must be one of the allowed types. " + AiPrompts.Text(AiPrompts.ChartSuggest, await PromptsAsync(tenantId, ct))),
            new("user", $"Dataset: {request.SourceName} ({request.RowCount} rows)\nColumns:\n{profile}Allowed chart types: {string.Join(", ", types)}"),
        };
        var raw = (await ai.CompleteAsync(tenantId, userId.ToString(), purpose, messages, ct)).Content;

        List<AiChartSuggestion> parsed;
        string? title = null;
        try
        {
            var s = raw.Trim();
            if (s.StartsWith("```")) { s = s[(s.IndexOf('\n') + 1)..]; var end = s.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) s = s[..end]; }
            if (goal is not null)
            {
                var start = s.IndexOf('{'); var stop = s.LastIndexOf('}');
                var obj = JsonSerializer.Deserialize<DashboardJson>(s[start..(stop + 1)], Json);
                parsed = obj?.Charts ?? [];
                title = Trim(obj?.Title, 100);
            }
            else
            {
                var start = s.IndexOf('['); var stop = s.LastIndexOf(']');
                parsed = JsonSerializer.Deserialize<List<AiChartSuggestion>>(s[start..(stop + 1)], Json) ?? [];
            }
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try again."); }

        var columns = request.Columns.Keys.ToList();
        string? Col(string? c) => c is null ? null : columns.FirstOrDefault(k => string.Equals(k, c.Trim(), StringComparison.OrdinalIgnoreCase));
        var valid = new List<AiChartSuggestion>();
        foreach (var sug in parsed)
        {
            var p = sug.Patch;
            if (p is null) continue;
            var type = types.FirstOrDefault(t => string.Equals(t, p.ChartType?.Trim(), StringComparison.OrdinalIgnoreCase));
            var x = Col(p.XAxis);
            if (type is null || x is null) continue;
            var yCol = Col(p.YAggColumn);
            // A numeric measure defaults to Sum; a missing or invalid function with no measure is a Count.
            var numeric = yCol is not null && request.Columns[yCol].Samples.Count > 0
                && request.Columns[yCol].Samples.All(v => double.TryParse(v, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out _));
            var fn = YFunctions.FirstOrDefault(f => string.Equals(f, p.YAxis?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (fn is null || fn is "Count (F)" or "Count Distinct (F)") fn = numeric ? "Sum (F)" : (fn ?? "Count (F)");
            if (fn is not ("Count (F)" or "Count Distinct (F)") && !numeric) { fn = "Count (F)"; yCol = null; }
            var top = p.LimitCategory?.ToLowerInvariant() == "top" && p.TopN is > 0 and <= 500 ? p.TopN : null;
            var patch = new AiChartState(type, x, fn, yCol, Trim(p.Title, 120) ?? $"{fn.Replace(" (F)", "")} of {yCol ?? "rows"} by {x}", null, null,
                null, null, null, null, top is null ? null : "top", top, null, null);
            if (valid.Any(v => v.Patch.ChartType == type && v.Patch.XAxis == x && v.Patch.YAggColumn == yCol)) continue;
            valid.Add(new AiChartSuggestion(patch, Trim(sug.Reason, 200) ?? ""));
            if (valid.Count == count) break;
        }
        return new AiDashboardSuggestion(title ?? goal ?? sourceName, valid);
    }

    private sealed record DashboardJson(string? Title, List<AiChartSuggestion>? Charts);

    private static string? Trim(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : (s.Trim().Length > max ? s.Trim()[..max] : s.Trim());

    /// <summary>
    /// Fire-and-forget on its own DI scope: the request scope (and its DbContext) is gone once the
    /// stream ends. Failures are swallowed on purpose; learning must never break answering.
    /// </summary>
    private void QueueExtraction(long tenantId, long userId, string sourceType, long sourceId, string sourceName, string question, AiQuerySpec spec,
        IReadOnlyList<string> columns, IReadOnlyList<AiDatasetNote> existingNotes)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopes.CreateScope();
                var aiSvc = scope.ServiceProvider.GetRequiredService<IAiService>();
                var repo = scope.ServiceProvider.GetRequiredService<IAiKnowledgeRepository>();
                var known = existingNotes.Select(n => $"{n.ColumnName ?? "(dataset)"}: {n.Note}").ToList();
                var pending = await repo.GetPendingProposalsAsync(tenantId, sourceType, sourceId, CancellationToken.None);
                var texts = await scope.ServiceProvider.GetRequiredService<IAiPromptStore>().GetAsync(tenantId, CancellationToken.None);
                var messages = new List<AiMessage>
                {
                    new("system",
                        AiPrompts.Text(AiPrompts.Extract, texts) + " Reply with JSON only: an array of 0-3 objects " +
                        "{\"column\":\"column name or null\",\"note\":\"one factual sentence\",\"confidence\":\"low|medium|high\"}. " +
                        "Return [] when nothing new was learned."),
                    new("user", $"Dataset: {sourceName}\nColumns: {string.Join(", ", columns)}\nAlready known:\n{string.Join("\n", known.Concat(pending.Select(p => $"{p.ColumnName ?? "(dataset)"}: {p.Note}")))}\nQuestion: {question}\nQuery used: {JsonSerializer.Serialize(spec, Json)}"),
                };
                var raw = (await aiSvc.CompleteAsync(tenantId, userId.ToString(), "extract", messages, CancellationToken.None)).Content.Trim();
                if (raw.StartsWith("```")) { raw = raw[(raw.IndexOf('\n') + 1)..]; var end = raw.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) raw = raw[..end]; }
                var start = raw.IndexOf('['); var stop = raw.LastIndexOf(']');
                if (start < 0 || stop <= start) return;
                var items = JsonSerializer.Deserialize<List<ProposalJson>>(raw[start..(stop + 1)], Json) ?? [];
                var rows = new List<AiNoteProposal>();
                foreach (var it in items.Take(3))
                {
                    var note = (it.Note ?? "").Trim();
                    if (note.Length < 8) continue;
                    var col = string.IsNullOrWhiteSpace(it.Column) ? null : columns.FirstOrDefault(c => string.Equals(c, it.Column.Trim(), StringComparison.OrdinalIgnoreCase));
                    if (!string.IsNullOrWhiteSpace(it.Column) && col is null) continue;
                    var dup = existingNotes.Any(n => n.ColumnName == col && n.Note.Contains(note, StringComparison.OrdinalIgnoreCase))
                           || pending.Any(p => p.ColumnName == col && string.Equals(p.Note, note, StringComparison.OrdinalIgnoreCase));
                    if (dup) continue;
                    rows.Add(new AiNoteProposal
                    {
                        TenantId = tenantId, SourceType = sourceType, SourceId = sourceId, ColumnName = col,
                        Note = note.Length > 1000 ? note[..1000] : note,
                        Confidence = it.Confidence?.ToLowerInvariant() is "low" or "high" ? it.Confidence.ToLowerInvariant() : "medium",
                        Question = question.Length > 2000 ? question[..2000] : question,
                    });
                }
                if (rows.Count > 0) await repo.AddProposalsAsync(rows, CancellationToken.None);
            }
            catch { /* best effort */ }
        });
    }

    private sealed record ProposalJson(string? Column, string? Note, string? Confidence);

    private const int MaxAutoExamples = 200;

    /// <summary>
    /// Saves an answered question as an example and has the model review it (SuperSonic's memory
    /// loop): approved examples guide later questions, rejected ones are kept only for admins to see.
    /// A question already saved for the dataset is skipped. Best effort; the answer is never affected.
    /// </summary>
    private void QueueMemory(long tenantId, long userId, string sourceType, long sourceId, string sourceName, long messageId, string question,
        AiQuerySpec spec, AiQueryResult result, string answer, IReadOnlyList<string> columns, string hints)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopes.CreateScope();
                var repo = scope.ServiceProvider.GetRequiredService<IAiKnowledgeRepository>();
                var q = question.Length > 2000 ? question[..2000] : question;
                if (await repo.HasExampleForQuestionAsync(tenantId, sourceType, sourceId, q, CancellationToken.None)) return;

                var example = new AiExample
                {
                    TenantId = tenantId, SourceType = sourceType, SourceId = sourceId, MessageId = messageId, Question = q,
                    QuerySpecJson = JsonSerializer.Serialize(spec, Json), Status = AiExampleStatus.Pending, CreatedBy = userId.ToString(),
                };
                await repo.AddExampleAsync(example, CancellationToken.None);

                var aiSvc = scope.ServiceProvider.GetRequiredService<IAiService>();
                var texts = await scope.ServiceProvider.GetRequiredService<IAiPromptStore>().GetAsync(tenantId, CancellationToken.None);
                var messages = new List<AiMessage>
                {
                    new("system",
                        AiPrompts.Text(AiPrompts.Review, texts) + " How the query format works: agg may be count, countDistinct, sum, avg, min or max; " +
                        "count with no column counts rows (right for \"how many rows / records / jobs\"); countDistinct of an id counts distinct items " +
                        "(right for \"how many wells\"); groupBy gives one result row per value; an alias is only a label; " +
                        "grouping by a column that is also filtered only shows that value next to the number and is fine. " +
                        "Reply with JSON only: {\"verdict\":\"good|bad\",\"reason\":\"one short sentence\"}."),
                    new("user", $"Dataset: {sourceName}\nColumns: {string.Join(", ", columns)}\n{hints}Question: {q}\nQuery: {JsonSerializer.Serialize(spec, Json)}\n" +
                        $"First result rows: {JsonSerializer.Serialize(result.Rows.Take(5), Json)}\nAnswer given: {answer}"),
                };
                var raw = (await aiSvc.CompleteAsync(tenantId, userId.ToString(), "review", messages, CancellationToken.None)).Content;
                var start = raw.IndexOf('{'); var stop = raw.LastIndexOf('}');
                if (start < 0 || stop <= start) return;
                var review = JsonSerializer.Deserialize<ReviewJson>(raw[start..(stop + 1)], Json);
                var verdict = review?.Verdict?.Trim().ToLowerInvariant();
                if (verdict is not ("good" or "bad")) return;

                // Re-read: the user may have rated the answer while the review ran, and that wins.
                var saved = await repo.GetExampleByMessageAsync(messageId, CancellationToken.None);
                if (saved is null || saved.Status != AiExampleStatus.Pending) return;
                saved.Status = verdict == "good" ? AiExampleStatus.Approved : AiExampleStatus.Rejected;
                var reason = (review!.Reason ?? "").Trim();
                saved.Review = reason.Length == 0 ? null : reason[..Math.Min(500, reason.Length)];
                await repo.SaveAsync(CancellationToken.None);
                await repo.PruneAutoExamplesAsync(tenantId, sourceType, sourceId, MaxAutoExamples, CancellationToken.None);
            }
            catch { /* best effort */ }
        });
    }

    private sealed record ReviewJson(string? Verdict, string? Reason);

    public async Task<bool> ReviewProposalAsync(long proposalId, bool approve, long tenantId, string userId, CancellationToken ct)
    {
        var p = await knowledge.GetProposalAsync(proposalId, tenantId, ct);
        if (p is null || p.Status != "pending") return false;
        if (approve) await knowledge.UpsertNoteAsync(tenantId, p.SourceType, p.SourceId, p.ColumnName, p.Note, userId, ct);
        p.Status = approve ? "approved" : "rejected";
        p.ReviewedBy = userId;
        p.ReviewedAt = DateTime.UtcNow;
        await knowledge.SaveAsync(ct);
        return true;
    }

    public async Task<bool> LikeAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Learning, ct)) throw new InvalidOperationException("Learning is not enabled for your role.");
        var (msg, conv) = await OwnedAssistantMessageAsync(messageId, tenantId, userId, ct);
        if (msg is null || conv is null || msg.QuerySpecJson is null) return false;
        return await RateAsync(msg, conv, AiExampleStatus.Liked, userId, ct);
    }

    public async Task<bool> DislikeAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Learning, ct)) throw new InvalidOperationException("Learning is not enabled for your role.");
        var (msg, conv) = await OwnedAssistantMessageAsync(messageId, tenantId, userId, ct);
        if (msg is null || conv is null || msg.QuerySpecJson is null) return false;
        return await RateAsync(msg, conv, AiExampleStatus.Disliked, userId, ct);
    }

    /// <summary>A person's rating always wins over the model's review: it sets the status of the message's example.</summary>
    private async Task<bool> RateAsync(AiChatMessage msg, AiConversation conv, string status, long userId, CancellationToken ct)
    {
        // A person's rating replaces the AI review's reason, so status and reason agree.
        var reason = status == AiExampleStatus.Liked ? "Liked by a user." : "Disliked by a user.";
        var existing = await knowledge.GetExampleByMessageAsync(msg.Id, ct);
        if (existing is not null)
        {
            existing.Status = status;
            existing.Review = reason;
            await knowledge.SaveAsync(ct);
            return true;
        }
        var question = (await conversations.GetMessagesAsync(conv.Id, ct)).Where(m => m.Role == "user" && m.Id < msg.Id).OrderByDescending(m => m.Id).FirstOrDefault();
        if (question is null) return false;
        await knowledge.AddExampleAsync(new AiExample
        {
            TenantId = conv.TenantId, SourceType = conv.SourceType, SourceId = conv.SourceId, MessageId = msg.Id,
            Question = question.Content, QuerySpecJson = msg.QuerySpecJson!, Status = status, Review = reason, CreatedBy = userId.ToString(),
        }, ct);
        return true;
    }

    public async Task<bool> UnlikeAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        var (msg, conv) = await OwnedAssistantMessageAsync(messageId, tenantId, userId, ct);
        if (msg is null || conv is null) return false;
        var e = await knowledge.GetExampleByMessageAsync(messageId, ct);
        if (e is not null) await knowledge.RemoveExampleAsync(e, ct);
        return true;
    }

    /// <summary>Master flag plus a role grant for the feature (admins always pass); missing settings count as off.</summary>
    public async Task<bool> FeatureOnAsync(long tenantId, string featureKey, CancellationToken ct)
    {
        var s = await settings.GetAsync(tenantId, ct);
        if (s is not { IsEnabled: true }) return false;
        return AiFeatureCatalog.IsAllowed(featureKey, currentUser.Roles, await grants.GetAsync(tenantId, ct));
    }

    private async Task<(AiChatMessage?, AiConversation?)> OwnedAssistantMessageAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        var msg = await conversations.GetMessageAsync(messageId, ct);
        if (msg is null || msg.Role != "assistant") return (null, null);
        var conv = await conversations.GetAsync(msg.ConversationId, tenantId, userId.ToString(), ct);
        return conv is null ? (null, null) : (msg, conv);
    }

    private static readonly TimeSpan LoadCacheTtl = TimeSpan.FromMinutes(10);

    /// <summary>
    /// The dataset as loaded for a question, kept 10 minutes per tenant and dataset: loading it was the
    /// slowest step of an answer (about 3 s) and was repeated for every follow-up. Big views are queried
    /// in their database anyway, so only small datasets can be up to 10 minutes old. Alerts load fresh.
    /// </summary>
    private async Task<(TableDataDto? data, string name, bool cached)> LoadCachedAsync(string sourceType, long sourceId, long tenantId, CancellationToken ct)
    {
        var key = $"ai:load:{tenantId}:{sourceType}:{sourceId}";
        if (cache.TryGetValue(key, out (TableDataDto data, string name) hit)) return (hit.data, hit.name, true);
        var (data, name) = await LoadAsync(sourceType, sourceId, tenantId, ct);
        if (data is { Columns.Count: > 0 }) cache.Set(key, (data, name), LoadCacheTtl);
        return (data, name, false);
    }

    private async Task<(TableDataDto? data, string name)> LoadAsync(string sourceType, long sourceId, long tenantId, CancellationToken ct)
    {
        if (sourceType == "view")
        {
            // Name only: the full view row carries the stored preview (up to ~100 MB on big views).
            var viewName = await views.GetNameAsync(sourceId, tenantId, ct) ?? throw new KeyNotFoundException("View not found.");
            var data = await sources.GetFilteredChartDataAsync(new ChartFilteredDataRequest(viewName, "View", sourceId, []), ct);
            return (data, viewName);
        }
        var ds = await imports.GetByIdAsync(sourceId, tenantId, ct) ?? throw new KeyNotFoundException("Imported dataset not found.");
        var d = await imports.GetDataAsync(sourceId, tenantId, ct);
        return (d is null ? null : new TableDataDto(d.Columns, d.Rows), ds.DatasetName);
    }

    /// <summary>Liked examples ranked by shared words with the question; ties broken by recency. Cheap and good enough without embeddings.</summary>
    private static List<AiMessage> BuildSpecMessages(string name, TableDataDto data, string question, IReadOnlyList<AiChatMessage> history,
        IReadOnlyList<AiDatasetNote> notes, IReadOnlyList<AiExample> examples, IReadOnlyList<AiMetric> metrics, bool sampleOnly,
        IReadOnlyList<AiColumnStats> profiles, string valueBlock, string extraRules)
    {
        var byColumn = profiles.ToDictionary(p => p.Column, StringComparer.OrdinalIgnoreCase);
        var columnNotes = notes.Where(n => n.ColumnName is not null && n.Note.Length > 0).ToDictionary(n => n.ColumnName!, n => n.Note, StringComparer.OrdinalIgnoreCase);
        var displayNames = DisplayNames(notes);
        var datasetNote = notes.FirstOrDefault(n => n.ColumnName is null)?.Note;
        var schema = new StringBuilder();
        foreach (var c in data.Columns)
        {
            // Counts, ranges and the full value list of low-cardinality columns tell the model which
            // filter values exist, so "Marmul" becomes eq 'Marmul ODC' rather than a guess.
            schema.Append("- ").Append(ColumnProfiler.Describe(byColumn[c]));
            // People ask by the display name; the query must still use the real column name.
            if (displayNames.TryGetValue(c, out var shown)) schema.Append(" — called \"").Append(shown).Append("\" by users");
            if (columnNotes.TryGetValue(c, out var note)) schema.Append(" — ").Append(note);
            schema.Append('\n');
        }
        var notesBlock = string.IsNullOrWhiteSpace(datasetNote) ? "" : $"Business notes: {datasetNote}\n";
        if (metrics.Count > 0)
            notesBlock += "Metrics (trusted definitions; when the question names one, use exactly this measure and alias it with the metric name):\n"
                + string.Join("", metrics.Select(m => $"- {m.Name} = {m.Agg}({m.ColumnName ?? "*"}){(string.IsNullOrWhiteSpace(m.Description) ? "" : " — " + m.Description)}\n"));

        var system = $$"""
            You translate questions about a dataset into a JSON query spec. Reply with JSON only, no prose, no code fences.
            Dataset "{{name}}", {{(sampleOnly ? $"more than {data.Rows.Count} rows (the query runs on all of them)" : $"{data.Rows.Count} rows")}}. Columns:
            {{schema}}{{valueBlock}}{{notesBlock}}
            Spec shape:
            {"select":["col"],"groupBy":["col"],"measures":[{"agg":"sum","column":"col","alias":"total"}],"filters":[{"column":"col","op":"eq","value":"x"}],"sort":{"column":"total","descending":true},"limit":20}
            Rules:
            - Use column names exactly as listed.
            - For totals, averages, counts or "by X" questions use groupBy + measures; for "show me rows" questions use select.
            - agg: count | countDistinct | sum | avg | min | max. count may omit column.
            - Counting things that have an id or code column (wells, jobs, crews, orders) means countDistinct of that column, because one thing can appear on many rows. Plain count (rows) only when the question asks for rows, records or entries. This holds even where an earlier example did otherwise.
            - op: eq | neq | gt | gte | lt | lte | contains | in | notNull | isNull. Dates as ISO strings.
            - sort must name an output column (a groupBy column or a measure alias). Default limit 20, max {{QuerySpecEngine.MaxLimit}}.
            - Use a column only when it means what the question asks for. If no column holds what the question asks for (for example it asks for downtime and no column is about downtime), do not guess: reply instead with
              {"missing":"one short sentence naming what this dataset does not have"}
            - Only when the question can really mean 2 or 3 different queries that give different numbers (for example a word that matches values in two different columns, or a measure that could be a count or a sum) and nothing above (business terms, metrics, notes, the conversation) settles it, reply instead with
              {"clarify":"one short question to the user","options":[ OPTION, OPTION ]} where each OPTION is {"label":"short plain description","spec": SPEC } and SPEC is a complete spec as above
              with 2 or 3 options. Every option must answer the question as asked; never offer unrelated columns as options. Otherwise always return a spec.
            """;
        // The admin's own rules (Settings → AI Features); they come after ours and cannot change the JSON format.
        if (!string.IsNullOrWhiteSpace(extraRules))
            system += "\nMandatory rules from your administrator (always follow them, even where an earlier example did not; only the JSON format above comes first):\n" + extraRules.Trim();
        var messages = new List<AiMessage> { new("system", system) };
        // Liked answers first (as prior turns), then the real conversation history.
        foreach (var e in examples)
        {
            messages.Add(new AiMessage("user", e.Question));
            messages.Add(new AiMessage("assistant", e.QuerySpecJson));
        }
        foreach (var m in history.TakeLast(HistoryTurns))
            messages.Add(new AiMessage(m.Role, m.Role == "assistant" ? m.QuerySpecJson ?? m.Content : m.Content));
        // Repeated next to the question: a rule at the end of a long prompt lost to examples that ignored it.
        messages.Add(new AiMessage("user", string.IsNullOrWhiteSpace(extraRules) ? question : $"{question}\n\n(Apply the administrator's rules: {extraRules.Trim()})"));
        return messages;
    }

    private static List<AiMessage> BuildAnswerMessages(string question, AiQuerySpec spec, AiQueryResult result, IReadOnlyList<string> insights, string instructions)
    {
        var sample = JsonSerializer.Serialize(Insights.WithBlankLabels(spec, result.Rows.Take(AnswerSampleRows)), Json);
        var note = result.SourceTruncated ? " Note: the dataset was capped at the first rows loaded, so figures may be partial; say so briefly." : "";
        var facts = insights.Count == 0 ? "" : "\nChecked facts (computed from all result rows; use these numbers, do not recompute):\n- " + string.Join("\n- ", insights);
        var advice = insights.Count == 0 ? "" : " Only when the checked facts show something that stands out (a value flagged as unusual, one group holding more than half of the total, many rows with no value, or a big change between periods) end with one short recommendation that starts with \"Suggestion:\" and says what to check in the data. Otherwise give no suggestion. Being the lowest or highest is not enough. Never recommend business actions such as increasing output, never give generic advice and never invent causes.";
        return
        [
            // The admin chooses the style; accuracy is not theirs to switch off.
            new("system", instructions + " Whatever the style, use only the result rows and checked facts given and quote their numbers exactly. The number of result rows is the number of groups, not a count of records; never present it as one or open with it. If the style asks to start with a number, start with the most important figure in the result, such as the total or the highest value, written in a sentence." + note + advice),
            new("user", $"Question: {question}\nQuery: {JsonSerializer.Serialize(spec, Json)}\nResult rows ({result.TotalRows} total, showing up to {AnswerSampleRows}): {sample}{facts}"),
        ];
    }

    private static AiQuerySpec ParseSpec(string raw)
    {
        var s = raw.Trim();
        if (s.StartsWith("```")) { s = s[(s.IndexOf('\n') + 1)..]; var end = s.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) s = s[..end]; }
        var start = s.IndexOf('{'); var stop = s.LastIndexOf('}');
        if (start < 0 || stop <= start) throw new JsonException("The reply was not a JSON object.");
        return JsonSerializer.Deserialize<AiQuerySpec>(s[start..(stop + 1)], Json) ?? throw new JsonException("Empty spec.");
    }

    private static readonly TimeSpan ProfileCacheTtl = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Finds stored values that contain the question's search words, so the model filters on
    /// "Marmul ODC" rather than guessing "Marmul". Low-cardinality columns are already listed in
    /// full by the profile, so only the other text columns are searched: in the view's database
    /// over every row when it is bigger than the loaded rows, otherwise in the loaded rows.
    /// </summary>
    private async Task<string> MatchValuesAsync(long tenantId, string sourceType, long sourceId, string question, TableDataDto data,
        IReadOnlyList<AiColumnStats> profiles, bool viewSampleOnly, CancellationToken ct)
    {
        var terms = ValueMatcher.Terms(question, data.Columns);
        if (terms.Count == 0) return "";
        var listed = profiles.Where(p => p.TopValues.Count > 0 && p.TopValues.Count == p.Distinct && !p.DistinctAtLeast).Select(p => p.Column).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var searchable = profiles.Where(p => p.Type == "text" && p.Distinct > 0 && !listed.Contains(p.Column)).Select(p => p.Column).ToList();

        // Values of fully listed columns are matched from the profile (it covers every row).
        var found = profiles.Where(p => listed.Contains(p.Column))
            .SelectMany(p => p.TopValues.Select(v => (p.Column, v.Value, v.Count)));
        var matches = ValueMatcher.Assign(terms, found).ToList();

        IReadOnlyList<AiValueMatch>? other = null;
        if (viewSampleOnly && searchable.Count > 0)
        {
            try { other = await viewQueries.FindValuesAsync(sourceId, tenantId, searchable, terms, ct); }
            catch (InvalidOperationException) { other = null; }
        }
        other ??= ValueMatcher.FindInRows(terms, data.Rows, searchable);
        matches = ValueMatcher.Assign(terms, matches.Concat(other).Select(m => (m.Column, m.Value, m.Count))).ToList();
        return ValueMatcher.Describe(matches, ValueMatcher.Unmatched(terms, matches, question));
    }

    /// <summary>
    /// Column profiles for the prompt, cached per dataset. Views bigger than the loaded rows are
    /// profiled in their database over every row; anything else from the rows already loaded.
    /// </summary>
    private async Task<IReadOnlyList<AiColumnStats>> ProfilesAsync(long tenantId, string sourceType, long sourceId, TableDataDto data, bool viewSampleOnly, CancellationToken ct)
    {
        var key = $"ai-profile:{tenantId}:{sourceType}:{sourceId}";
        if (cache.TryGetValue(key, out IReadOnlyList<AiColumnStats>? hit) && hit is not null && hit.Count == data.Columns.Count) return hit;

        IReadOnlyList<AiColumnStats>? profiles = null;
        if (viewSampleOnly)
        {
            try { profiles = await viewQueries.ProfileAsync(sourceId, tenantId, data.Columns, ct); }
            catch (InvalidOperationException) { profiles = null; }
        }
        if (profiles is null)
        {
            var profiler = new ColumnProfiler(data.Columns);
            foreach (var row in data.Rows) profiler.Add(row);
            profiles = profiler.Build();
        }
        // The database profile lists values only for low-cardinality columns; give the rest examples from the loaded rows.
        profiles = profiles.Select(p => p.TopValues.Count > 0 || p.Samples.Count > 0 ? p : p with
        {
            Samples = data.Rows.Select(r => r.TryGetValue(p.Column, out var v) ? v?.ToString() : null)
                .Where(v => !string.IsNullOrEmpty(v)).Distinct().Take(5).ToList()!,
        }).ToList();
        // A declared column type beats inference from values.
        if (data.ColumnTypes is { Count: > 0 } declared)
            profiles = profiles.Select(p => declared.TryGetValue(p.Column, out var t) && !string.IsNullOrWhiteSpace(t) ? p with { Type = t } : p).ToList();
        if (!viewSampleOnly) cache.Set(key, profiles, ProfileCacheTtl);
        else if (profiles.Count > 0 && profiles[0].Rows > data.Rows.Count) cache.Set(key, profiles, ProfileCacheTtl);
        return profiles;
    }


    private async IAsyncEnumerable<(string Text, string? Error)> Stream(long tenantId, long userId, string purpose, List<AiMessage> messages, [EnumeratorCancellation] CancellationToken ct)
    {
        await using var e = ai.StreamAsync(tenantId, userId.ToString(), purpose, messages, ct).GetAsyncEnumerator(ct);
        while (true)
        {
            string? error = null;
            var more = false;
            try { more = await e.MoveNextAsync(); }
            catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException) { error = ex.Message; }
            if (error is not null) { yield return ("", error); yield break; }
            if (!more) yield break;
            yield return (e.Current, null);
        }
    }

    public async Task<AiQueryResult> RunSpecAsync(string sourceType, long sourceId, long tenantId, AiQuerySpec spec, CancellationToken ct)
    {
        var (data, _) = await LoadAsync(sourceType, sourceId, tenantId, ct);
        if (data is null || data.Columns.Count == 0) throw new InvalidOperationException("The dataset has no columns or could not be loaded.");
        var source = new AiConversation { SourceType = sourceType, SourceId = sourceId };
        return await RunQueryAsync(source, data, IsTruncated(sourceType, data), QuerySpecEngine.Validate(spec, data.Columns), tenantId, [], ct);
    }

    public async Task<IReadOnlyList<string>> ColumnsAsync(string sourceType, long sourceId, long tenantId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Ask, ct)) throw new InvalidOperationException("Ask your data is not enabled for your role.");
        var (data, _, _) = await LoadCachedAsync(sourceType, sourceId, tenantId, ct);
        return data?.Columns ?? [];
    }

    public async Task<TableDataDto?> SampleAsync(string sourceType, long sourceId, long tenantId, CancellationToken ct)
    {
        try { return (await LoadCachedAsync(sourceType, sourceId, tenantId, ct)).data; }
        catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException) { return null; }
    }

    /// <summary>Only the first rows were loaded: views are then queried in their database, imports flagged as partial.</summary>
    private static bool IsTruncated(string sourceType, TableDataDto data) =>
        sourceType == "view" ? data.Rows.Count >= 1000 : data.Rows.Count >= 10_000;

    /// <summary>Views are answered by their database over every row; imports are held in full already.</summary>
    private async Task<AiQueryResult> RunQueryAsync(AiConversation conv, TableDataDto data, bool truncated, AiQuerySpec spec, long tenantId, List<AiTraceStep> trace, CancellationToken ct)
    {
        var start = Stopwatch.GetTimestamp();
        var inDatabase = conv.SourceType == "view" && truncated ? await viewQueries.RunAsync(conv.SourceId, tenantId, spec, data.Columns, ct) : null;
        var result = inDatabase ?? QuerySpecEngine.Execute(spec, data.Columns, data.Rows, truncated);
        trace.Add(new("query", Ms(start), $"{(inDatabase is null ? "Run in memory" : "Run in the database over every row")}: {result.TotalRows} result rows"));
        return result;
    }

    public async Task<IReadOnlyList<AiTraceStep>?> GetTraceAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Trace, ct)) throw new InvalidOperationException("Prompt trace is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var (msg, _) = await OwnedAssistantMessageAsync(messageId, tenantId, userId, ct);
        var trace = msg is null ? null : await conversations.GetTraceAsync(msg.Id, ct);
        return trace is null ? null : JsonSerializer.Deserialize<List<AiTraceStep>>(trace.TraceJson, Json);
    }

    /// <summary>
    /// Insight report for a stored answer: the query runs again, the trend, findings and anomalies are worked
    /// out in code (Insights) and the AI only turns them into recommendations, so every number is checked.
    /// </summary>
    public async Task<AiInsightReportDto?> ReportAsync(long messageId, long tenantId, long userId, CancellationToken ct)
    {
        if (!await FeatureOnAsync(tenantId, AiFeatureCatalog.Ask, ct)) throw new InvalidOperationException("Ask your data is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var (msg, conv) = await OwnedAssistantMessageAsync(messageId, tenantId, userId, ct);
        if (msg?.QuerySpecJson is null || conv is null) return null;
        var spec = JsonSerializer.Deserialize<AiQuerySpec>(msg.QuerySpecJson, Json)!;
        var result = await RunSpecAsync(conv.SourceType, conv.SourceId, tenantId, spec, ct);
        var facts = Insights.Report(spec, result);
        if (facts.Trend.Count + facts.Findings.Count + facts.Anomalies.Count == 0)
            throw new InvalidOperationException("A report needs an answer with at least 3 groups, such as a \"by month\" or \"by well\" question.");
        var question = (await conversations.GetMessagesAsync(conv.Id, ct)).LastOrDefault(m => m.Role == "user" && m.Id < msg.Id)?.Content ?? conv.Title;

        var all = facts.Trend.Concat(facts.Findings).Concat(facts.Anomalies).ToList();
        var messages = new List<AiMessage>
        {
            new("system", AiPrompts.Text(AiPrompts.Report, await PromptsAsync(tenantId, conv.SourceType, conv.SourceId, ct)) +
                " Reply with JSON only: {\"recommendations\":[\"...\"]} with at most 3 strings, or an empty array."),
            new("user", $"Question: {question}\nQuery: {JsonSerializer.Serialize(spec, Json)}\nChecked findings:\n- {string.Join("\n- ", all)}"),
        };
        var raw = (await ai.CompleteAsync(tenantId, userId.ToString(), "report", messages, ct)).Content.Trim();
        List<string> recommendations;
        try
        {
            if (raw.StartsWith("```")) { raw = raw[(raw.IndexOf('\n') + 1)..]; var end = raw.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) raw = raw[..end]; }
            var start = raw.IndexOf('{'); var stop = raw.LastIndexOf('}');
            recommendations = JsonSerializer.Deserialize<ReportJson>(raw[start..(stop + 1)], Json)?.Recommendations?
                .Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).Take(3).ToList() ?? [];
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try again."); }
        return new AiInsightReportDto(question, conv.SourceName, result.TotalRows, facts.Trend, facts.Findings, facts.Anomalies, recommendations);
    }

    private sealed record ReportJson(List<string>? Recommendations);

    /// <summary>Admin display names by column (Dataset notes → "Shown as").</summary>
    private static Dictionary<string, string> DisplayNames(IReadOnlyList<AiDatasetNote> notes) =>
        notes.Where(n => n.ColumnName is not null && !string.IsNullOrWhiteSpace(n.DisplayName))
            .ToDictionary(n => n.ColumnName!, n => n.DisplayName!, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Display names for the result's columns: a group column keeps its own; a measure column gets
    /// the display name of the column it aggregates ("Sum of FLAF score" style is left to the header).
    /// Null when no column has one.
    /// </summary>
    private static IReadOnlyDictionary<string, string>? ResultLabels(AiQuerySpec spec, AiQueryResult result, IReadOnlyDictionary<string, string> names)
    {
        if (names.Count == 0) return null;
        var labels = new Dictionary<string, string>();
        foreach (var c in result.Columns)
        {
            if (names.TryGetValue(c, out var n)) { labels[c] = n; continue; }
            var m = spec.Measures?.FirstOrDefault(x => (x.Alias ?? x.Agg) == c);
            if (m?.Column is not null && names.TryGetValue(m.Column, out var mn)) labels[c] = $"{Wording.Capitalize(Wording.Words(m.Agg))} of {mn}";
        }
        return labels.Count == 0 ? null : labels;
    }

    /// <summary>The tenant's AI prompts (Settings → AI Prompts), from the database.</summary>
    private Task<IReadOnlyDictionary<string, string>> PromptsAsync(long tenantId, CancellationToken ct) => prompts.GetAsync(tenantId, ct);

    /// <summary>The tenant's instructions with the dataset's own overrides (Ask AI → Dataset notes) on top.</summary>
    private async Task<IReadOnlyDictionary<string, string>> PromptsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        AiPrompts.Merge(await PromptsAsync(tenantId, ct), await knowledge.GetDatasetPromptsAsync(tenantId, sourceType, sourceId, ct));

    private static int Ms(long start) => (int)Stopwatch.GetElapsedTime(start).TotalMilliseconds;

    private static AiAskEvent Error(string message) => new("error", message);
}
