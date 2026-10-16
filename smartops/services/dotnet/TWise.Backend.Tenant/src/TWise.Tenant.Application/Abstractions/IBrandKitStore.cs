using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>The tenant's saved brand kits. Deleted kits are left out of every read.</summary>
public interface IBrandKitStore
{
    /// <summary>The tenant's kits, by name.</summary>
    Task<IReadOnlyList<BrandKit>> ListAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Tracked, so SaveAsync writes changes made to it. Null when missing, deleted or another tenant's.</summary>
    Task<BrandKit?> GetAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>True when another kit of the tenant has the name, ignoring case.</summary>
    Task<bool> NameTakenAsync(long tenantId, string name, long? exceptId, CancellationToken ct = default);

    Task AddAsync(BrandKit kit, CancellationToken ct = default);

    Task SaveAsync(CancellationToken ct = default);
}
