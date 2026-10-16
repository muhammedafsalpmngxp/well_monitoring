using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// Repository contract for Dashboard operations.
/// </summary>
public interface IDashboardRepository
{
    /// <summary>
    /// Check if a dashboard with the same name exists in the given category.
    /// </summary>
    Task<bool> DashboardExistsAsync(string dashboardName, int categoryId, CancellationToken ct = default);

    /// <summary>
    /// Check if a category exists by ID.
    /// </summary>
    Task<bool> CategoryExistsAsync(int categoryId, CancellationToken ct = default);

    /// <summary>
    /// Create a new dashboard record.
    /// </summary>
    Task<Dashboard> CreateDashboardAsync(Dashboard dashboard, CancellationToken ct = default);

    /// <summary>
    /// Get all active categories ordered by name.
    /// </summary>
    Task<IReadOnlyList<Category>> GetDashboardCategoriesAsync(CancellationToken ct = default);

    /// <summary>
    /// Get dashboards by status, including category and widget count.
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetDashboardsByStatusAsync(string status, CancellationToken ct = default);

    /// <summary>
    /// Get dashboards matching any of the given statuses.
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetDashboardsByStatusesAsync(IEnumerable<string> statuses, CancellationToken ct = default);

    /// <summary>
    /// Get dashboards created by a specific user, filtered by statuses.
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetDashboardsByCreatorAsync(string createdBy, IEnumerable<string> statuses, CancellationToken ct = default);

    /// <summary>
    /// Get dashboard by ID.
    /// </summary>
    Task<Dashboard?> GetDashboardByIdAsync(int dashboardId, CancellationToken ct = default);

    /// <summary>
    /// Get dashboard by ID with widgets included.
    /// </summary>
    Task<Dashboard?> GetDashboardDetailByIdAsync(int dashboardId, CancellationToken ct = default);

    /// <summary>
    /// Publish a dashboard (update status, set published info).
    /// </summary>
    Task<Dashboard> PublishDashboardAsync(Dashboard dashboard, CancellationToken ct = default);

    /// <summary>
    /// Update a dashboard (name, description, config, soft-delete, toggle active).
    /// </summary>
    Task<Dashboard> UpdateDashboardAsync(Dashboard dashboard, CancellationToken ct = default);

    Task UpdateDashboardConfigAsync(Dashboard dashboard, CancellationToken ct = default);

    Task<T> ExecuteInTransactionAsync<T>(Func<Task<T>> action, CancellationToken ct = default);

    /// <summary>
    /// Get published dashboards, optionally including admin-only Inactive ones. Only the
    /// latest version of each series is returned (older versions are archived history).
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetPublishedListAsync(bool includeInactive, CancellationToken ct = default);

    /// <summary>
    /// Get the current latest published version of a dashboard series, if any.
    /// </summary>
    Task<Dashboard?> GetLatestVersionAsync(Guid seriesId, CancellationToken ct = default);

    /// <summary>
    /// Highest VersionNo ever assigned within a series, regardless of IsLatestVersion (which
    /// is already false right after an Unpublish) — used to compute the next version number.
    /// </summary>
    Task<int?> GetMaxVersionNoAsync(Guid seriesId, CancellationToken ct = default);

    /// <summary>
    /// Get the single un-versioned (Draft/Completed) row for a series, if one is being edited.
    /// </summary>
    Task<Dashboard?> GetActiveDraftForSeriesAsync(Guid seriesId, CancellationToken ct = default);

    /// <summary>
    /// Get all published versions (history) of a dashboard series, newest first.
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetVersionHistoryAsync(Guid seriesId, CancellationToken ct = default);

    /// <summary>
    /// Publish a draft as the next version of its series: archives the previous latest
    /// version (kept, not deleted) and saves both rows in one transaction.
    /// </summary>
    Task<Dashboard> PublishNewVersionAsync(Dashboard? previousLatest, Dashboard newVersion, CancellationToken ct = default);

    /// <summary>
    /// One specific published version within a series, or null when that version does not exist.
    /// </summary>
    Task<Dashboard?> GetVersionAsync(Guid seriesId, int versionNo, CancellationToken ct = default);

    /// <summary>
    /// Archives the current latest version and inserts <paramref name="restoredVersion"/> as a new
    /// row, atomically. Distinct from <see cref="PublishNewVersionAsync"/>, which promotes an
    /// existing draft row rather than adding one.
    /// </summary>
    Task<Dashboard> RestoreVersionAsync(Dashboard? previousLatest, Dashboard restoredVersion, CancellationToken ct = default);

    /// <summary>
    /// Archive a published version and spawn (or reuse) the series' editable draft, atomically.
    /// </summary>
    Task<Dashboard> UnpublishToNewDraftAsync(Dashboard archivedPublished, Dashboard? newDraft, CancellationToken ct = default);

    /// <summary>
    /// Get all non-deleted dashboards (any status) so the caller can filter by the ConfigJson
    /// `_meta.sharedWithUserIds` marker in-memory (unstructured JSON, cannot be queried in SQL).
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetAllDashboardsForShareLookupAsync(CancellationToken ct = default);

    /// <summary>
    /// Lean candidate set for the internal-share notification bell: only dashboards modified after
    /// <paramref name="since"/> AND whose ConfigJson mentions the share marker at all (both filters
    /// pushed into SQL), so polling this on an interval stays cheap regardless of table size — unlike
    /// <see cref="GetAllDashboardsForShareLookupAsync"/> which scans/returns every dashboard.
    /// </summary>
    Task<IReadOnlyList<Dashboard>> GetShareNotificationCandidatesAsync(DateTime since, CancellationToken ct = default);
}
