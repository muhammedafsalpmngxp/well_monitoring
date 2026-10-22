using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>"Ask your data": question → query spec → rows → short answer, streamed as events.</summary>
public interface IAiAskService
{
    Task<IReadOnlyList<AiDatasetDto>> ListDatasetsAsync(long tenantId, long userId, CancellationToken ct);
    IAsyncEnumerable<AiAskEvent> AskAsync(AiAskRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Explains a chart's rendered data in a few sentences: headline, key figures, trend, outliers. Streams answer/done/error events.</summary>
    IAsyncEnumerable<AiAskEvent> SummarizeAsync(AiSummaryRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Explains a whole dashboard from its charts' rendered data. Streams answer/done/error events; cached by data hash.</summary>
    IAsyncEnumerable<AiAskEvent> SummarizeDashboardAsync(AiDashboardSummaryRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Recommends which columns of the placed charts' sources would make good dashboard-wide filters.</summary>
    Task<IReadOnlyList<AiFilterSuggestion>> SuggestFiltersAsync(AiFilterSuggestRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Turns a plain-language instruction into a validated patch of Chart Builder fields.</summary>
    Task<AiChartEditResponse> EditChartAsync(AiChartEditRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Up to three chart suggestions for a loaded data source, validated against its columns and the chart types offered.</summary>
    Task<IReadOnlyList<AiChartSuggestion>> SuggestChartsAsync(AiChartSuggestRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Approves a pending proposal into the dataset notes (admin). False when not found or not pending.</summary>
    Task<bool> ReviewProposalAsync(long proposalId, bool approve, long tenantId, string userId, CancellationToken ct);

    /// <summary>A dashboard title and up to six validated chart patches for a dataset and a stated goal.</summary>
    Task<AiDashboardSuggestion> SuggestDashboardAsync(AiDashboardSuggestRequest request, long tenantId, long userId, CancellationToken ct);

    /// <summary>Marks an assistant answer as good: its question + spec become an example for that dataset. Owner only; idempotent.</summary>
    Task<bool> LikeAsync(long messageId, long tenantId, long userId, CancellationToken ct);
    /// <summary>Removes the example created by LikeAsync. Owner only.</summary>
    Task<bool> UnlikeAsync(long messageId, long tenantId, long userId, CancellationToken ct);

    /// <summary>Thumbs-down: the answer is kept as an example marked disliked, so it is never used to guide others.</summary>
    Task<bool> DislikeAsync(long messageId, long tenantId, long userId, CancellationToken ct);

    /// <summary>The steps behind an answer (prompts, replies, timings). Owner only; null when not found or no trace kept.</summary>
    Task<IReadOnlyList<AiTraceStep>?> GetTraceAsync(long messageId, long tenantId, long userId, CancellationToken ct);
    /// <summary>Insight report (trend, findings, anomalies, recommendations) for an own answer; null when not found.</summary>
    Task<AiInsightReportDto?> ReportAsync(long messageId, long tenantId, long userId, CancellationToken ct);

    /// <summary>Loads the dataset and runs a validated spec over every row, like an answer does, without any AI call.</summary>
    Task<AiQueryResult> RunSpecAsync(string sourceType, long sourceId, long tenantId, AiQuerySpec spec, CancellationToken ct);

    /// <summary>The dataset's real column names, as the AI sees them (for the term and metric pickers).</summary>
    Task<IReadOnlyList<string>> ColumnsAsync(string sourceType, long sourceId, long tenantId, CancellationToken ct);
    /// <summary>The first rows of a dataset as the ask loads them (10-minute cache); null when it cannot be loaded.</summary>
    Task<TableDataDto?> SampleAsync(string sourceType, long sourceId, long tenantId, CancellationToken ct);

    /// <summary>AI switched on for the tenant and the feature granted to one of the current user's roles.</summary>
    Task<bool> FeatureOnAsync(long tenantId, string featureKey, CancellationToken ct);

    /// <summary>Saves an own Ask Data answer's SQL as a data source (a database view on the tenant's connection to the Ask
    /// Data database), checked again like an export, so it can be charted or put on a dashboard. Reuses the view saved for
    /// that answer before. Null when the message is not an own Ask Data answer; InvalidOperationException with the reason
    /// when it cannot be saved.</summary>
    Task<AskDataViewDto?> SaveAskDataViewAsync(long messageId, long tenantId, long userId, CancellationToken ct);
}

public interface IAiAlertRepository
{
    Task<IReadOnlyList<AiAlert>> ListAsync(long tenantId, string userId, CancellationToken ct);
    /// <summary>Tracked. Any owner when userId is null (the worker).</summary>
    Task<AiAlert?> GetAsync(long id, long tenantId, string? userId, CancellationToken ct);
    /// <summary>Ids of up to <paramref name="max"/> alerts due by <paramref name="now"/>, oldest first.</summary>
    Task<IReadOnlyList<(long Id, long TenantId)>> DueAsync(DateTime now, int max, CancellationToken ct);
    void Add(AiAlert alert);
    void Remove(AiAlert alert);
    Task SaveAsync(CancellationToken ct);
}

/// <summary>Watched answers: create from an answer, list, check now, delete; the worker checks due ones.</summary>
public interface IAiAlertService
{
    Task<IReadOnlyList<AiAlertDto>> ListAsync(long tenantId, long userId, CancellationToken ct);
    /// <summary>From one of the user's answers; checked once straight away (no notification). Null when the answer is not theirs.</summary>
    Task<AiAlertDto?> CreateAsync(CreateAiAlertRequest request, long tenantId, long userId, CancellationToken ct);
    /// <summary>Runs the check now; userId null = the worker (any owner). Notifies the owner when it starts firing.</summary>
    Task<AiAlertDto?> CheckAsync(long id, long tenantId, long? userId, CancellationToken ct);
    Task<bool> DeleteAsync(long id, long tenantId, long userId, CancellationToken ct);
}

public interface IAiConversationRepository
{
    Task<IReadOnlyList<AiConversation>> ListAsync(long tenantId, string userId, CancellationToken ct);
    Task<AiConversation?> GetAsync(long id, long tenantId, string userId, CancellationToken ct);
    Task<IReadOnlyList<AiChatMessage>> GetMessagesAsync(long conversationId, CancellationToken ct);
    Task<AiChatMessage?> GetMessageAsync(long messageId, CancellationToken ct);
    Task AddAsync(AiConversation conversation, CancellationToken ct);
    Task AddMessageAsync(AiChatMessage message, CancellationToken ct);
    Task SaveAsync(CancellationToken ct);
    /// <summary>Saves a trace and drops traces older than 30 days.</summary>
    Task AddTraceAsync(AiTrace trace, CancellationToken ct);
    Task<AiTrace?> GetTraceAsync(long messageId, CancellationToken ct);
    /// <summary>Assistant answers of every user since a date, newest first, with their conversation and trace (admin activity page).</summary>
    Task<(int Total, IReadOnlyList<(AiChatMessage Message, AiConversation Conversation, AiTrace? Trace)> Items)> SearchAnswersAsync(
        long tenantId, DateTime since, string? search, int skip, int take, CancellationToken ct);
    /// <summary>A conversation of the tenant regardless of owner (admin reads).</summary>
    Task<AiConversation?> GetForTenantAsync(long id, long tenantId, CancellationToken ct);
    /// <summary>The question that led to an assistant message: the last user message before it in the conversation.</summary>
    Task<IReadOnlyDictionary<long, string>> GetQuestionsAsync(IReadOnlyCollection<long> assistantMessageIds, CancellationToken ct);
}
