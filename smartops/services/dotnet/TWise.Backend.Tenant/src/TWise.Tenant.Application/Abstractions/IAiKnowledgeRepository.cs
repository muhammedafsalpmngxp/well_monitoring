using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>Notes and liked examples that ground the ask-your-data prompt for one dataset.</summary>
public interface IAiKnowledgeRepository
{
    Task<IReadOnlyList<AiDatasetNote>> GetNotesAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct);
    /// <summary>Replaces every note of the dataset with the given set (empty notes are dropped).</summary>
    Task ReplaceNotesAsync(long tenantId, string sourceType, long sourceId, IReadOnlyList<AiDatasetNote> notes, CancellationToken ct);

    Task<IReadOnlyList<AiDatasetRelation>> GetRelationsAsync(long tenantId, CancellationToken ct);
    Task<AiDatasetRelation?> GetRelationAsync(long id, long tenantId, CancellationToken ct);
    Task AddRelationAsync(AiDatasetRelation relation, CancellationToken ct);
    Task RemoveRelationAsync(AiDatasetRelation relation, CancellationToken ct);
    /// <summary>Drops the still-suggested links among the given datasets so a new scan can replace them; confirmed and rejected ones stay.</summary>
    Task RemoveSuggestedRelationsAsync(long tenantId, IReadOnlyCollection<string> datasetKeys, CancellationToken ct);
    Task SaveRelationsAsync(CancellationToken ct);

    Task<IReadOnlyList<AiDatasetPrompt>> GetDatasetPromptsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct);
    /// <summary>Sets one dataset instruction; an empty text removes it.</summary>
    Task UpsertDatasetPromptAsync(long tenantId, string sourceType, long sourceId, string key, string? text, string userId, CancellationToken ct);

    Task<IReadOnlyList<AiExample>> GetExamplesAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct);
    Task<AiExample?> GetExampleByMessageAsync(long messageId, CancellationToken ct);
    Task<AiExample?> GetExampleAsync(long id, long tenantId, CancellationToken ct);
    Task AddExampleAsync(AiExample example, CancellationToken ct);
    /// <summary>True when the dataset already has an example for this question (case-insensitive).</summary>
    Task<bool> HasExampleForQuestionAsync(long tenantId, string sourceType, long sourceId, string question, CancellationToken ct);
    /// <summary>Keeps the newest automatically saved examples of a dataset; liked and disliked ones are never dropped.</summary>
    Task PruneAutoExamplesAsync(long tenantId, string sourceType, long sourceId, int keep, CancellationToken ct);
    Task RemoveExampleAsync(AiExample example, CancellationToken ct);

    Task<IReadOnlyList<AiMetric>> GetMetricsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct);
    /// <summary>Replaces every metric of the dataset with the given set.</summary>
    Task ReplaceMetricsAsync(long tenantId, string sourceType, long sourceId, IReadOnlyList<AiMetric> metrics, CancellationToken ct);

    Task<IReadOnlyList<AiTerm>> GetTermsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct);
    /// <summary>Replaces every term of the dataset with the given set.</summary>
    Task ReplaceTermsAsync(long tenantId, string sourceType, long sourceId, IReadOnlyList<AiTerm> terms, CancellationToken ct);

    Task<IReadOnlyList<AiNoteProposal>> GetPendingProposalsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct);
    Task<AiNoteProposal?> GetProposalAsync(long id, long tenantId, CancellationToken ct);
    Task AddProposalsAsync(IReadOnlyList<AiNoteProposal> proposals, CancellationToken ct);
    /// <summary>Adds or extends one note (column null = dataset) without touching the others.</summary>
    Task UpsertNoteAsync(long tenantId, string sourceType, long sourceId, string? column, string note, string userId, CancellationToken ct);
    Task SaveAsync(CancellationToken ct);
}
