using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public class CategoryRepository(TenantDbContext db) : ICategoryRepository
{
    public async Task<IReadOnlyList<Category>> GetAllAsync(string? controlType = null, string? createdBy = null, CancellationToken ct = default)
    {
        var query = db.Set<Category>()
            .AsNoTracking()
            .Where(c => !c.IsDeleted);
        if (!string.IsNullOrWhiteSpace(controlType))
            query = query.Where(c => c.ControlType == controlType);
        if (!string.IsNullOrWhiteSpace(createdBy))
            query = query.Where(c => c.CategoryId == 1 || c.CreatedBy == createdBy);
        return await query.OrderBy(c => c.CategoryName).ToListAsync(ct);
    }

    public async Task<Category?> GetByIdAsync(int categoryId, CancellationToken ct = default)
    {
        return await db.Set<Category>()
            .FirstOrDefaultAsync(c => c.CategoryId == categoryId && !c.IsDeleted, ct);
    }

    public async Task<Category?> GetByIdWithDashboardsAsync(int categoryId, CancellationToken ct = default)
    {
        return await db.Set<Category>()
            .AsTracking()
            .Include(c => c.Dashboards.Where(d => !d.IsDeleted))
            .FirstOrDefaultAsync(c => c.CategoryId == categoryId && !c.IsDeleted, ct);
    }

    public async Task<bool> ExistsByNameAsync(string categoryName, string controlType, CancellationToken ct = default, int? excludeId = null, string? createdBy = null)
    {
        var query = db.Set<Category>()
            .Where(c => EF.Functions.Collate(c.CategoryName, "Latin1_General_CI_AS") == categoryName && c.ControlType == controlType && !c.IsDeleted);
        if (excludeId.HasValue)
            query = query.Where(c => c.CategoryId != excludeId.Value);
        if (!string.IsNullOrWhiteSpace(createdBy))
            query = query.Where(c => c.CategoryId == 1 || c.CreatedBy == createdBy);
        return await query.AnyAsync(ct);
    }

    public async Task CreateAsync(Category category, CancellationToken ct = default)
    {
        await db.Set<Category>().AddAsync(category, ct);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(Category category, CancellationToken ct = default)
    {
        db.Set<Category>().Update(category);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyDictionary<int, int>> GetItemCountsByCategoryAsync(string controlType, string? userId, bool isAdmin, CancellationToken ct = default)
    {
        // Category Manager is only opened from WIP-style pages, so counts must mirror those
        // pages' own item lists — own items, not deleted, excluding inactive and published —
        // e.g. GetWipDashboardsHandler uses Draft/Completed; WIP Charts/Tiles/Reports filter
        // out "published" from the user's own non-inactive widgets/reports.
        _ = long.TryParse(userId, out var userIdLong);
        IQueryable<int>? categoryIds = controlType.ToLowerInvariant() switch
        {
            "dashboard" => db.Set<Dashboard>()
                .Where(d => !d.IsDeleted && d.CreatedBy == userId
                    && (d.Status == DashboardStatus.Draft || d.Status == DashboardStatus.Completed))
                .Select(d => d.CategoryId),
            "chart" => db.Widgets
                .Where(w => w.CategoryId != null && w.Type == "chart" && !w.IsDeleted && w.CreatedBy == userIdLong
                    && w.Status != "inactive" && w.Status != "published")
                .Select(w => w.CategoryId!.Value),
            "tile" => db.Widgets
                .Where(w => w.CategoryId != null && w.Type == "tile" && !w.IsDeleted && w.CreatedBy == userIdLong
                    && w.Status != "inactive" && w.Status != "published")
                .Select(w => w.CategoryId!.Value),
            "report" => db.Reports
                .Where(r => !r.IsDeleted && r.CreatedBy == userIdLong
                    && r.Status != "inactive" && r.Status != "published")
                .Select(r => r.CategoryId),
            _ => null,
        };

        if (categoryIds is null)
            return new Dictionary<int, int>();

        var counts = await categoryIds
            .GroupBy(id => id)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return counts.ToDictionary(x => x.CategoryId, x => x.Count);
    }
}
