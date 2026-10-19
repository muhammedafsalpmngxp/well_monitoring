using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// The tenant's AI prompts, in the tenant database only: the active texts in core.AiPrompt and every
/// version in core.AiPromptHistory. A key the tenant does not have yet is copied from the seed (version 1, 'seed')
/// the first time it is needed, so new tenants and new keys need no manual step. Saves and restores are atomic.
/// </summary>
public interface IAiPromptStore
{
    /// <summary>The active text of every prompt, {key: text}. Cached; refreshed when core.AiSettings.row_ver changes.</summary>
    Task<IReadOnlyDictionary<string, string>> GetAsync(long tenantId, CancellationToken ct);

    /// <summary>Every prompt with its version, original and last change, in catalog order.</summary>
    Task<IReadOnlyList<AiPromptItemDto>> ListAsync(long tenantId, CancellationToken ct);

    /// <summary>Every saved version of one prompt, newest first.</summary>
    Task<IReadOnlyList<AiPromptVersionDto>> HistoryAsync(long tenantId, string key, CancellationToken ct);

    /// <summary>Saves a new version. Throws InvalidOperationException with the reason when the text breaks a rule or
    /// someone saved a newer version than <paramref name="expectedVersion"/>.</summary>
    Task<AiPromptItemDto> SaveAsync(long tenantId, string key, string? text, string? note, int? expectedVersion, string userId, CancellationToken ct);

    /// <summary>Makes an earlier version (1 = the original) the active one, as a new version.</summary>
    Task<AiPromptItemDto> RestoreAsync(long tenantId, string key, int version, int? expectedVersion, string? note, string userId, CancellationToken ct);
}
