using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed partial class DaxModelRepository(TenantDbContext db) : IDaxModelRepository
{
    public async Task<(IReadOnlyList<SavedDaxModel> Items, int Total)> ListAsync(DaxModelListFilter f, CancellationToken ct = default)
    {
        var query = Owned(db.DaxModels.AsNoTracking(), f.OwnerId);
        if (!string.IsNullOrEmpty(f.Search)) query = query.Where(m => m.Name.Contains(f.Search));
        if (!string.IsNullOrEmpty(f.Status)) query = query.Where(m => m.Status == f.Status);
        if (f.SinceDays is int days)
        {
            var since = DateTime.UtcNow.AddDays(-days);
            query = query.Where(m => m.CreatedAt >= since);
        }

        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(m => m.CreatedAt).ThenByDescending(m => m.Id)
            .Skip((f.Page - 1) * f.PageSize).Take(f.PageSize).ToListAsync(ct);
        return (items, total);
    }

    public async Task<(int All, int Tables, int Views)> CountBySourceTypeAsync(long? ownerId, CancellationToken ct = default)
    {
        var counts = await Owned(db.DaxModels.AsNoTracking(), ownerId).GroupBy(m => m.SourceType)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        int Of(string type) => counts.Where(c => c.Key == type).Sum(c => c.Count);
        return (counts.Sum(c => c.Count), Of("Table"), Of("View"));
    }

    public Task<SavedDaxModel?> GetByIdAsync(long id, long? ownerId, CancellationToken ct = default)
        => Owned(db.DaxModels, ownerId).FirstOrDefaultAsync(m => m.Id == id && !m.IsDeleted, ct);

    /// <summary>One user's models; every model when ownerId is null (admins).</summary>
    private static IQueryable<SavedDaxModel> Owned(IQueryable<SavedDaxModel> query, long? ownerId)
        => ownerId is long owner ? query.Where(m => m.CreatedBy == owner) : query;

    public async Task<SavedDaxModel> AddAsync(SavedDaxModel model, CancellationToken ct = default)
    {
        db.DaxModels.Add(model);
        await db.SaveChangesAsync(ct);
        return model;
    }

    public async Task UpdateAsync(SavedDaxModel model, CancellationToken ct = default)
    {
        model.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    [GeneratedRegex(@"""savedModelId""\s*:\s*""?(\d+)")]
    private static partial Regex SavedModelIdPattern();

    public async Task<IReadOnlyList<DaxModelChartUse>> ListChartsUsingAsync(long id, CancellationToken ct = default)
    {
        // Same charts as CountChartUsageAsync counts; the id text filter keeps the read to likely matches.
        var idText = id.ToString();
        var charts = await db.Widgets.AsNoTracking()
            .Where(w => w.Type == "chart" && w.DesignJson != null && w.DesignJson.Contains("\"savedModelId\"") && w.DesignJson.Contains(idText))
            .Select(w => new { w.Name, w.CreatedBy, w.Status, w.DesignJson }).ToListAsync(ct);
        return charts
            .Where(c => SavedModelIdPattern().Matches(c.DesignJson!).Any(m => long.Parse(m.Groups[1].Value) == id))
            .OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Select(c => new DaxModelChartUse(c.Name, c.CreatedBy, c.Status == "published")).ToList();
    }

    public async Task<IReadOnlyDictionary<long, int>> CountChartUsageAsync(IReadOnlyCollection<long> ids, CancellationToken ct = default)
    {
        if (ids.Count == 0) return new Dictionary<long, int>();
        // Only charts whose design mentions a saved model are read; each counts once per model.
        var designs = await db.Widgets.AsNoTracking()
            .Where(w => w.Type == "chart" && w.DesignJson != null && w.DesignJson.Contains("\"savedModelId\""))
            .Select(w => w.DesignJson!).ToListAsync(ct);
        var wanted = ids.ToHashSet();
        var result = new Dictionary<long, int>();
        foreach (var design in designs)
            foreach (var id in SavedModelIdPattern().Matches(design).Select(m => long.Parse(m.Groups[1].Value)).Distinct())
                if (wanted.Contains(id)) result[id] = result.GetValueOrDefault(id) + 1;
        return result;
    }
}
