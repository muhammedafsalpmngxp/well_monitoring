using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class WidgetRepository(TenantDbContext db) : IWidgetRepository
{
    public async Task<IReadOnlyList<Widget>> GetAllAsync(
        string? status, string? type, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var query = db.Widgets
            .AsNoTracking()
            .Include(w => w.Category)
            .AsQueryable();

        if (status == "published")
        {
            // Published widgets are shared — visible to everyone, including admins.
            query = query.Where(w => w.Status == "published" && !w.IsDeleted);
        }
        else
        {
            // Non-published: users (admins included) only see their own widgets.
            query = query.Where(w => w.CreatedBy == userId && !w.IsDeleted);
            query = status is not null
                ? query.Where(w => w.Status == status)
                : query.Where(w => w.Status != "inactive");
        }

        if (type is not null)
            query = query.Where(w => w.Type == type);

        return await query.ToListAsync(ct);
    }

    public async Task<Widget?> GetAccessibleByIdAsync(long id, long userId, CancellationToken ct = default)
        => await db.Widgets
            .Include(w => w.Category)
            .FirstOrDefaultAsync(w => w.Id == id && (w.CreatedBy == userId || w.Status == "published"), ct);

    public async Task<IReadOnlyList<Widget>> GetByIdsAsync(IReadOnlyCollection<long> ids, CancellationToken ct = default)
        => ids.Count == 0
            ? []
            : await db.Widgets.Include(w => w.Category).Where(w => ids.Contains(w.Id)).ToListAsync(ct);

    public async Task<Widget> CreateAndLoadCategoryAsync(Widget widget, CancellationToken ct = default)
    {
        db.Widgets.Add(widget);
        await db.SaveChangesAsync(ct);
        if (widget.CategoryId.HasValue)
            await db.Entry(widget).Reference(w => w.Category).LoadAsync(ct);
        return widget;
    }

    public async Task<Widget> SaveAndLoadCategoryAsync(Widget widget, CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
        if (widget.CategoryId.HasValue)
            await db.Entry(widget).Reference(w => w.Category).LoadAsync(ct);
        return widget;
    }

    public async Task<Widget> PublishCopyToSourceAsync(Widget source, Widget copy, CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
        await db.Entry(source).Reference(w => w.Category).LoadAsync(ct);
        return source;
    }

    public async Task<bool> SoftDeleteAsync(long id, long userId, CancellationToken ct = default)
    {
        var widget = await db.Widgets
            .FirstOrDefaultAsync(w => w.Id == id && w.CreatedBy == userId, ct);

        if (widget is null) return false;

        widget.IsDeleted = true;
        widget.Status = "inactive";
        widget.ModifiedOn = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public Task<int> CountActiveByCategoryAsync(int categoryId, CancellationToken ct = default)
    {
        return db.Widgets.CountAsync(w => w.CategoryId == categoryId && !w.IsDeleted, ct);
    }

    public Task<bool> IsDuplicateNameAsync(
        string name, string type, long userId, long? excludeId, CancellationToken ct = default)
    {
        return db.Widgets.AnyAsync(
            w => !w.IsDeleted
              && w.Name == name
              && w.Type == type
              && w.CreatedBy == userId
              && (excludeId == null || w.Id != excludeId),
            ct);
    }
}
