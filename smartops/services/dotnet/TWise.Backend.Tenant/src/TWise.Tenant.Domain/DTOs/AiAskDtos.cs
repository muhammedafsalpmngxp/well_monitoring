namespace TWise.Tenant.Domain.DTOs;

/// <summary>A dataset the user can ask about: a database view or an imported file.</summary>
public record AiDatasetDto(string SourceType, long SourceId, string Name, string? Description, int? RowCount);

/// <summary>ConversationId null starts a new thread on the given dataset; otherwise the dataset comes from the thread.</summary>
/// <param name="Spec">An option the user picked from a clarification: run it as given (after validation) instead of asking the model.</param>
public record AiAskRequest(long? ConversationId, string? SourceType, long? SourceId, string Question, AiQuerySpec? Spec = null);

/// <summary>The model's question back to the user when the question can mean different queries.</summary>
public record AiClarification(string Question, IReadOnlyList<AiClarifyOption> Options);

public record AiClarifyOption(string Label, AiQuerySpec Spec);

/// <summary>One step behind an answer. Step: load | context | ask | query | rejected | answer. Prompt and Reply only for AI calls.</summary>
/// <summary>Kind: above | below | unusual; Threshold for above/below; EveryHours: 1, 24 or 168.</summary>
public record CreateAiAlertRequest(long MessageId, string Kind, double? Threshold, int EveryHours = 24, string? NotifyEmails = null);

public record AiAlertDto(long Id, string SourceType, long SourceId, string SourceName, string Question, string Kind, double? Threshold, int EveryHours, string? NotifyEmails,
    bool IsTriggered, string? LastMessage, DateTime? LastCheckedAt, DateTime NextCheckAt);

/// <summary>Insight report for a stored answer: checked findings (code) and the AI's recommendations from them.</summary>
public record AiInsightReportDto(string Question, string SourceName, int TotalRows, IReadOnlyList<string> Trend, IReadOnlyList<string> Findings,
    IReadOnlyList<string> Anomalies, IReadOnlyList<string> Recommendations);

public record AiTraceStep(string Step, int Ms, string? Detail, IReadOnlyList<AiMessage>? Prompt = null, string? Reply = null);

/// <summary>
/// What the model is allowed to produce: a query over one dataset's columns. It is validated against
/// the real schema and executed in memory by QuerySpecEngine, so the model never writes SQL.
/// </summary>
public record AiQuerySpec(
    IReadOnlyList<string>? Select,
    IReadOnlyList<string>? GroupBy,
    IReadOnlyList<AiMeasure>? Measures,
    IReadOnlyList<AiFilter>? Filters,
    AiSort? Sort,
    int? Limit);

/// <summary>Agg: count | countDistinct | sum | avg | min | max. Column may be null for count.</summary>
public record AiMeasure(string Agg, string? Column, string? Alias);

/// <summary>Op: eq | neq | gt | gte | lt | lte | contains | in | notNull | isNull.</summary>
public record AiFilter(string Column, string Op, object? Value);

public record AiSort(string Column, bool Descending);

/// <summary>Labels: display names for result columns that have one (admin-set per dataset), for table headers.</summary>
public record AiQueryResult(IReadOnlyList<string> Columns, IReadOnlyList<Dictionary<string, object?>> Rows, int TotalRows, int SourceRows, bool SourceTruncated,
    IReadOnlyDictionary<string, string>? Labels = null);

public record AiConversationDto(long Id, string SourceType, long SourceId, string SourceName, string Title, DateTime ModifiedAt);

public record AiChatMessageDto(long Id, string Role, string Content, AiQuerySpec? QuerySpec, DateTime CreatedAt);

public record AiConversationDetailDto(AiConversationDto Conversation, IReadOnlyList<AiChatMessageDto> Messages);

/// <summary>The rendered data of one chart, as shown to the user (aggregated, at most a few hundred rows).</summary>
public record AiSummaryRequest(string Title, IReadOnlyList<string> Columns, IReadOnlyList<Dictionary<string, object?>> Rows, string? Context, bool Force = false);

/// <summary>A view's SQL to explain and tune; ViewId resolves the stored SQL when Sql is empty.</summary>
public record AiSqlReviewRequest(long ConnectionId, string? Sql, long? ViewId);
/// <summary>Facts read from the database's estimated plan (SQL Server), without running the query.</summary>
public record SqlPlanFacts(int Statements, IReadOnlyList<string> Scans, IReadOnlyList<string> MissingIndexes, IReadOnlyList<string> Warnings, double EstimatedCost, double EstimatedRows);
public record AiSqlIssueDto(string Severity, string Text);
public record AiSqlReviewDto(string Explanation, IReadOnlyList<AiSqlIssueDto> Issues, IReadOnlyList<string> Suggestions, string? OptimisedSql, string? OptimisedNote, SqlPlanFacts? Plan);

/// <summary>The charts of a dashboard, for a narrated slide deck.</summary>
public record AiDeckRequest(string Title, IReadOnlyList<AiSummaryRequest> Charts);
/// <summary>One slide per chart: a short title, 2-4 bullets and a takeaway; plus an opening headline and a closing slide.</summary>
public record AiDeckSlideDto(string Title, IReadOnlyList<string> Bullets, string? Takeaway);
public record AiDeckDto(string Title, string Headline, IReadOnlyList<AiDeckSlideDto> Slides, string Closing);

/// <summary>Every chart of a dashboard as rendered; Force skips the cache (Regenerate).</summary>
public record AiDashboardSummaryRequest(string Title, IReadOnlyList<AiSummaryRequest> Charts, bool Force = false);

/// <summary>Column profile computed by the client from the rows it already has: distinct count and a few sample values.</summary>
public record AiColumnProfile(int Distinct, IReadOnlyList<string> Samples);

public record AiFilterSuggestChart(string Title, string SourceTable, string SourceType, IReadOnlyDictionary<string, AiColumnProfile> Columns);

public record AiFilterSuggestRequest(string DashboardName, IReadOnlyList<AiFilterSuggestChart> Charts, IReadOnlyList<string> AlreadyAdded);

public record AiFilterSuggestion(string SourceTable, string SourceColumn, string Label, string Reason);

/// <summary>The editable part of a Chart Builder state. Every field optional in a patch; unknown fields are ignored.</summary>
public record AiChartState(
    string? ChartType, string? XAxis, string? YAxis, string? YAggColumn, string? Title, string? XAxisTitle, string? YAxisTitle,
    bool? ShowLegend, bool? ShowDataLabels, bool? ShowAxisTitle, bool? IncludeDataTable,
    string? LimitCategory, int? TopN, int? BottomN, bool? GroupRestAsOthers);

/// <summary>Instruction plus what the builder currently shows and what it may choose from.</summary>
public record AiChartEditRequest(string Instruction, AiChartState Current, IReadOnlyList<string> Columns, IReadOnlyList<string> ChartTypes);

/// <summary>Patch: only the fields to change. Message: one sentence for the user (what was done or why not).</summary>
public record AiChartEditResponse(AiChartState Patch, string Message);

/// <summary>Column profile plus the chart types on offer; the model proposes up to three charts.</summary>
public record AiChartSuggestRequest(string SourceName, int RowCount, IReadOnlyDictionary<string, AiColumnProfile> Columns, IReadOnlyList<string> ChartTypes);

/// <summary>Same profile as a chart suggestion plus what the dashboard is for; up to six charts come back.</summary>
public record AiDashboardSuggestRequest(string SourceName, int RowCount, IReadOnlyDictionary<string, AiColumnProfile> Columns, IReadOnlyList<string> ChartTypes, string Goal);

public record AiDashboardSuggestion(string Title, IReadOnlyList<AiChartSuggestion> Charts);

/// <summary>A suggested chart: the builder fields to apply plus a one-line reason.</summary>
public record AiChartSuggestion(AiChartState Patch, string Reason);

/// <summary>One server-sent event during an ask. Type: status | spec | result | answer | done | error.</summary>
public record AiAskEvent(string Type, object? Data);
