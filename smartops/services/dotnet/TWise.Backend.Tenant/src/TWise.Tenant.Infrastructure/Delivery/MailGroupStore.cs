using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Delivery;

public sealed class MailGroupStore(TenantDbContext db) : IMailGroupStore
{
    public async Task<IReadOnlyList<MailGroup>> ListAsync(long tenantId, CancellationToken ct = default)
        => await db.MailGroups.AsNoTracking().Include(g => g.Members).Where(g => g.TenantId == tenantId).OrderBy(g => g.Name).ToListAsync(ct);

    public Task<MailGroup?> GetAsync(long id, long tenantId, CancellationToken ct = default)
        => db.MailGroups.Include(g => g.Members).FirstOrDefaultAsync(g => g.Id == id && g.TenantId == tenantId, ct);

    public Task<bool> NameTakenAsync(long tenantId, string name, long? exceptId, CancellationToken ct = default)
        => db.MailGroups.AnyAsync(g => g.TenantId == tenantId && g.Name == name && g.Id != (exceptId ?? 0), ct);

    public async Task<IReadOnlyDictionary<long, IReadOnlyList<string>>> MembersAsync(
        long tenantId, IReadOnlyCollection<long> groupIds, CancellationToken ct = default)
        => await db.MailGroups.AsNoTracking().Include(g => g.Members)
            .Where(g => g.TenantId == tenantId && groupIds.Contains(g.Id))
            .ToDictionaryAsync(g => g.Id, g => (IReadOnlyList<string>)g.Members.Select(m => m.Email).ToList(), ct);

    public async Task AddAsync(MailGroup group, CancellationToken ct = default)
    {
        db.MailGroups.Add(group);
        await db.SaveChangesAsync(ct);
    }

    public Task SaveAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
