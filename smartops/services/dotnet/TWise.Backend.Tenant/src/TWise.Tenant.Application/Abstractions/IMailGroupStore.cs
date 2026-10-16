using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>The tenant's mail groups. Deleted groups are left out of every read.</summary>
public interface IMailGroupStore
{
    /// <summary>The tenant's groups with their members, by name.</summary>
    Task<IReadOnlyList<MailGroup>> ListAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Tracked, with its members, so SaveAsync writes changes. Null when missing, deleted or another tenant's.</summary>
    Task<MailGroup?> GetAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>True when another group of the tenant has the name.</summary>
    Task<bool> NameTakenAsync(long tenantId, string name, long? exceptId, CancellationToken ct = default);

    /// <summary>The addresses of each of the groups that still exist, by group id.</summary>
    Task<IReadOnlyDictionary<long, IReadOnlyList<string>>> MembersAsync(
        long tenantId, IReadOnlyCollection<long> groupIds, CancellationToken ct = default);

    Task AddAsync(MailGroup group, CancellationToken ct = default);

    Task SaveAsync(CancellationToken ct = default);
}
