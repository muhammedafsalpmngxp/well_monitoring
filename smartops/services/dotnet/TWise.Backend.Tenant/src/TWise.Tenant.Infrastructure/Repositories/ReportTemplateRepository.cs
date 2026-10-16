using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class ReportTemplateRepository(TenantDbContext db) : IReportTemplateRepository
{
    // ── GET BY SOURCE + TYPE + USER ──────────────────────────────────────────────────
    // Legacy rows predate the Type/IsActive columns, so null there means "Report" / active.
    // sourceName and sourceType are optional filters here; type and userId are always applied.
    // Returns every matching row for the user (not just one), since sourceName being omitted means "all sources of this type".
    public async Task<List<ReportTemplate>> GetBySourceAsync(
        string? sourceName, string? sourceType, string type, string? customName, long userId, CancellationToken ct = default)
        => await db.ReportTemplates
            .AsNoTracking()
            .Where(t => (sourceName == null || t.SourceName == sourceName)
                && (sourceType == null || t.SourceType == sourceType)
                && t.CreatedBy == userId
                && (customName == null || t.CustomName == customName)
                && (t.Type == type || (t.Type == null && type == "Report"))
                && (t.IsActive == true || t.IsActive == null))
            .ToListAsync(ct);

    // ── UPSERT — one row per (SourceName, SourceType, Type, CreatedBy, CustomName) ───────
    // ViewId only applies to View sources, mirrors WidgetService's SourceId handling.
    public async Task<ReportTemplate> UpsertAsync(
        string customName, string sourceName, string sourceType, string templateJson, string type, long? viewId, long userId, long tenantId, CancellationToken ct = default)
    {
        var resolvedViewId = sourceType == "View" ? viewId : null;
        var existing = await db.ReportTemplates
            .FirstOrDefaultAsync(t => t.SourceName == sourceName && t.SourceType == sourceType && t.CreatedBy == userId
                && t.CustomName == customName
                && (t.Type == type || (t.Type == null && type == "Report")), ct);

        if (existing is not null)
        {
            existing.TemplateJson = templateJson;
            existing.Type = type;
            existing.ViewId = resolvedViewId;
            existing.IsActive = true;
            existing.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var created = new ReportTemplate
        {
            TenantId = tenantId,
            CreatedBy = userId,
            CustomName = customName,
            SourceName = sourceName,
            SourceType = sourceType,
            TemplateJson = templateJson,
            Type = type,
            ViewId = resolvedViewId,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        db.ReportTemplates.Add(created);
        try
        {
            await db.SaveChangesAsync(ct);
            return created;
        }
        catch (DbUpdateException)
        {
            db.Entry(created).State = EntityState.Detached;

            // Prefer the row with the same CustomName; fall back to SourceName+SourceType+CreatedBy
            // only for legacy rows that predate the CustomName/Type columns.
            var conflicting = await db.ReportTemplates
                .FirstOrDefaultAsync(t => t.SourceName == sourceName && t.SourceType == sourceType && t.CreatedBy == userId
                    && t.CustomName == customName, ct)
                ?? await db.ReportTemplates
                .FirstOrDefaultAsync(t => t.SourceName == sourceName && t.SourceType == sourceType && t.CreatedBy == userId, ct);
            if (conflicting is null) throw;

            conflicting.CustomName = customName;
            conflicting.TemplateJson = templateJson;
            conflicting.Type = type;
            conflicting.ViewId = resolvedViewId;
            conflicting.IsActive = true;
            conflicting.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return conflicting;
        }
    }
}
