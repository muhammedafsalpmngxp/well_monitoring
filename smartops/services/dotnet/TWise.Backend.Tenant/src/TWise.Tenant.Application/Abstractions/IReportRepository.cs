using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IReportRepository
{
    Task<IReadOnlyList<Report>> GetFilteredAsync(string? status, long userId, bool isAdmin, CancellationToken ct = default);
    Task<Report?> GetByIdForReadAsync(long id, long userId, CancellationToken ct = default);
    Task<Report?> GetByIdAndOwnerAsync(long id, long userId, CancellationToken ct = default);
    Task<Report?> GetByIdForUpdateAsync(long id, long userId, bool isAdmin, CancellationToken ct = default);
    Task<bool> ExistsDuplicateAsync(string reportName, string sourceName, long userId, CancellationToken ct = default);
    Task<Report> CreateAndLoadCategoryAsync(Report report, CancellationToken ct = default);
    Task<Report> SaveAndLoadCategoryAsync(Report report, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(long id, long userId, CancellationToken ct = default);

    // ── Version history ──────────────────────────────────────────────────────

    /// <summary>Appends an immutable snapshot. VersionNo is assigned by the repository.</summary>
    Task<ReportVersion> AddVersionAsync(ReportVersion version, CancellationToken ct = default);

    /// <summary>Highest version number recorded for a report, or null when none exist yet.</summary>
    Task<int?> GetMaxVersionNoAsync(long reportId, CancellationToken ct = default);

    /// <summary>All snapshots for a report, newest first.</summary>
    Task<IReadOnlyList<ReportVersion>> GetVersionsAsync(long reportId, long tenantId, CancellationToken ct = default);

    /// <summary>One snapshot, or null when that version does not exist.</summary>
    Task<ReportVersion?> GetVersionAsync(long reportId, int versionNo, long tenantId, CancellationToken ct = default);
}
