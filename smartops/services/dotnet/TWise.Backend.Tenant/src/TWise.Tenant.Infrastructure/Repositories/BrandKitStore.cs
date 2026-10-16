using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities.Model;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class BrandKitStore(TenantDbContext db) : IBrandKitStore
{
    public async Task<IReadOnlyList<BrandKit>> ListAsync(long tenantId, CancellationToken ct = default)
        => await db.BrandKits.AsNoTracking().Where(k => k.TenantId == tenantId).OrderBy(k => k.Name).ToListAsync(ct);

    public Task<BrandKit?> GetAsync(long id, long tenantId, CancellationToken ct = default)
        => db.BrandKits.FirstOrDefaultAsync(k => k.Id == id && k.TenantId == tenantId, ct);

    public Task<bool> NameTakenAsync(long tenantId, string name, long? exceptId, CancellationToken ct = default)
        => db.BrandKits.AnyAsync(k => k.TenantId == tenantId && k.Name == name && k.Id != (exceptId ?? 0), ct);

    public async Task AddAsync(BrandKit kit, CancellationToken ct = default)
    {
        db.BrandKits.Add(kit);
        await db.SaveChangesAsync(ct);
    }

    public Task SaveAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
