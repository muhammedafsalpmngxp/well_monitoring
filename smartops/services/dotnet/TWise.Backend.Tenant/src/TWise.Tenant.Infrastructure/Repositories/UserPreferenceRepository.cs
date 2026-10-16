using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class UserPreferenceRepository(TenantDbContext db) : IUserPreferenceRepository
{
    public async Task<UserPreference> ToggleFavouriteAsync(
        long userId, int controlTypeId, long controlId, CancellationToken ct = default)
    {
        var pref = await db.UserPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.ControlTypeId == controlTypeId && p.ControlId == controlId, ct);

        if (pref is null)
        {
            pref = new UserPreference { UserId = userId, ControlTypeId = controlTypeId, ControlId = controlId, IsFavourite = true };
            db.UserPreferences.Add(pref);
        }
        else
        {
            pref.IsFavourite = !pref.IsFavourite;
        }

        await db.SaveChangesAsync(ct);
        return pref;
    }

    public async Task TrackViewAsync(
        long userId, int controlTypeId, long controlId, CancellationToken ct = default)
    {
        var pref = await db.UserPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.ControlTypeId == controlTypeId && p.ControlId == controlId, ct);

        if (pref is null)
        {
            pref = new UserPreference { UserId = userId, ControlTypeId = controlTypeId, ControlId = controlId, LastViewedOn = DateTime.UtcNow };
            db.UserPreferences.Add(pref);
        }
        else
        {
            pref.LastViewedOn = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }

    public Task<IReadOnlyList<UserPreference>> GetFavouritesAsync(
        long userId, int? controlTypeId, CancellationToken ct = default)
    {
        var q = db.UserPreferences.AsNoTracking()
            .Where(p => p.UserId == userId && p.IsFavourite);

        if (controlTypeId.HasValue)
            q = q.Where(p => p.ControlTypeId == controlTypeId.Value);

        return q.OrderBy(p => p.ControlId)
                .ToListAsync(ct)
                .ContinueWith(t => (IReadOnlyList<UserPreference>)t.Result, ct);
    }

    public Task<IReadOnlyList<UserPreference>> GetRecentlyViewedAsync(
        long userId, int? controlTypeId, int limit, CancellationToken ct = default)
    {
        var q = db.UserPreferences.AsNoTracking()
            .Where(p => p.UserId == userId && p.LastViewedOn != null);

        if (controlTypeId.HasValue)
            q = q.Where(p => p.ControlTypeId == controlTypeId.Value);

        return q.OrderByDescending(p => p.LastViewedOn)
                .Take(limit)
                .ToListAsync(ct)
                .ContinueWith(t => (IReadOnlyList<UserPreference>)t.Result, ct);
    }

    public Task<UserPreference?> GetAsync(
        long userId, int controlTypeId, long controlId, CancellationToken ct = default)
        => db.UserPreferences.AsNoTracking()
               .FirstOrDefaultAsync(p => p.UserId == userId && p.ControlTypeId == controlTypeId && p.ControlId == controlId, ct);
}
