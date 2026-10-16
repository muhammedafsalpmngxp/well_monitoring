using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class ReportRepository(TenantDbContext db) : IReportRepository
{
    // ── GET ALL (filtered) ───────────────────────────────────────────────────
    public async Task<IReadOnlyList<Report>> GetFilteredAsync(
        string? status, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var query = db.Reports
            .AsNoTracking()
            .Include(r => r.Category)
            .Where(r => !r.IsDeleted)
            .AsQueryable();

        if (isAdmin)
        {
            // "published" is a shared library — show all published reports, not just the user's own
            if (status == "published")
            {
                query = query.Where(r => r.Status == "published");
            }
            else
            {
                query = query.Where(r => r.CreatedBy == userId);
                query = status is not null
                    ? query.Where(r => r.Status == status)
                    : query.Where(r => r.Status != "inactive");
            }
        }
        else if (status == "published")
        {
            query = query.Where(r => r.Status == "published");
        }
        else
        {
            query = query.Where(r => r.CreatedBy == userId);
            query = status is not null
                ? query.Where(r => r.Status == status)
                : query.Where(r => r.Status != "inactive");
        }

        return await query.ToListAsync(ct);
    }

    // ── GET BY ID (READ) — owner OR published ────────────────────────────────
    public async Task<Report?> GetByIdForReadAsync(long id, long userId, CancellationToken ct = default)
        => await db.Reports
            .Include(r => r.Category)
            .FirstOrDefaultAsync(r => r.Id == id && !r.IsDeleted
                && (r.CreatedBy == userId || r.Status == "published"), ct);

    // ── GET BY ID + OWNER (WRITE) — owner only ───────────────────────────────
    public async Task<Report?> GetByIdAndOwnerAsync(long id, long userId, CancellationToken ct = default)
        => await db.Reports
            .Include(r => r.Category)
            .FirstOrDefaultAsync(r => r.Id == id && r.CreatedBy == userId && !r.IsDeleted, ct);

    public async Task<Report?> GetByIdForUpdateAsync(long id, long userId, bool isAdmin, CancellationToken ct = default)
        => await db.Reports
            .Include(r => r.Category)
            .FirstOrDefaultAsync(r => r.Id == id && !r.IsDeleted && (isAdmin || r.CreatedBy == userId), ct);

    // ── DUPLICATE CHECK ──────────────────────────────────────────────────────
    public Task<bool> ExistsDuplicateAsync(
        string reportName, string sourceName, long userId, CancellationToken ct = default)
        => db.Reports.AnyAsync(
            r => r.ReportName == reportName && r.SourceName == sourceName && r.CreatedBy == userId && !r.IsDeleted, ct);

    // ── CREATE ───────────────────────────────────────────────────────────────
    public async Task<Report> CreateAndLoadCategoryAsync(Report report, CancellationToken ct = default)
    {
        db.Reports.Add(report);
        await db.SaveChangesAsync(ct);
        await db.Entry(report).Reference(r => r.Category).LoadAsync(ct);
        return report;
    }

    // ── SAVE (UPDATE) ────────────────────────────────────────────────────────
    public async Task<Report> SaveAndLoadCategoryAsync(Report report, CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
        await db.Entry(report).Reference(r => r.Category).LoadAsync(ct);
        return report;
    }

    // ── SOFT DELETE ──────────────────────────────────────────────────────────
    public async Task<bool> SoftDeleteAsync(long id, long userId, CancellationToken ct = default)
    {
        var report = await db.Reports
            .FirstOrDefaultAsync(r => r.Id == id && r.CreatedBy == userId, ct);

        if (report is null) return false;

        report.IsDeleted = true;
        report.Status    = "inactive";
        report.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return true;
    }

    // ── VERSION HISTORY ──────────────────────────────────────────────────────

    public async Task<ReportVersion> AddVersionAsync(ReportVersion version, CancellationToken ct = default)
    {
        db.ReportVersions.Add(version);
        await db.SaveChangesAsync(ct);
        return version;
    }

    public async Task<int?> GetMaxVersionNoAsync(long reportId, CancellationToken ct = default)
    {
        var numbers = await db.ReportVersions
            .Where(v => v.ReportId == reportId)
            .Select(v => v.VersionNo)
            .ToListAsync(ct);

        return numbers.Count > 0 ? numbers.Max() : (int?)null;
    }

    public async Task<IReadOnlyList<ReportVersion>> GetVersionsAsync(long reportId, long tenantId, CancellationToken ct = default)
        => await db.ReportVersions
            .AsNoTracking()
            .Where(v => v.ReportId == reportId && v.TenantId == tenantId)
            .OrderByDescending(v => v.VersionNo)
            .ToListAsync(ct);

    public async Task<ReportVersion?> GetVersionAsync(long reportId, int versionNo, long tenantId, CancellationToken ct = default)
        => await db.ReportVersions
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.ReportId == reportId && v.VersionNo == versionNo && v.TenantId == tenantId, ct);
}
