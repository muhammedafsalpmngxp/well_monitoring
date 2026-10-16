using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IReportService
{
    Task<IReadOnlyList<ReportDto>> GetAllAsync(string? status, long userId, bool isAdmin, CancellationToken ct = default);
    Task<ReportDto?> GetByIdAsync(long id, long userId, CancellationToken ct = default);
    Task<ReportDto> CreateAsync(CreateReportRequest request, long userId, long tenantId, CancellationToken ct = default);
    Task<ReportDto?> UpdateAsync(long id, UpdateReportRequest request, long userId, bool isAdmin, CancellationToken ct = default);
    Task<ReportDto?> CopyToDraftAsync(long id, long userId, bool isAdmin, long tenantId, CancellationToken ct = default);
    Task<bool> DeleteAsync(long id, long userId, CancellationToken ct = default);

    // ── Version history ──────────────────────────────────────────────────────

    /// <summary>Published snapshots for a report, newest first.</summary>
    Task<IReadOnlyList<ReportVersionSummaryDto>?> GetVersionsAsync(
        long id, long userId, long tenantId, CancellationToken ct = default);

    /// <summary>
    /// Replays an earlier published snapshot onto the live report. Append-only: the restore
    /// itself is recorded as a new version, so history is preserved rather than rewritten.
    /// Admin only.
    /// </summary>
    Task<RestoreReportVersionResponse?> RestoreVersionAsync(
        long id, int versionNo, long userId, bool isAdmin, long tenantId, CancellationToken ct = default);
}
