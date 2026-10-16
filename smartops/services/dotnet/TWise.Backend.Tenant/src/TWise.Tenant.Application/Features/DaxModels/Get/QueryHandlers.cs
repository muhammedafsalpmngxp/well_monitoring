using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class ListDaxModelsHandler(IDaxModelRepository repo, IRecipientResolver directory) : IRequestHandler<ListDaxModelsQuery, DaxModelPageDto>
{
    public async Task<DaxModelPageDto> Handle(ListDaxModelsQuery q, CancellationToken ct)
    {
        long? owner = q.IsAdmin ? null : q.UserId;
        var (items, total) = await repo.ListAsync(new DaxModelListFilter(q.Search?.Trim(), q.Status, q.SinceDays, q.Page, q.PageSize, owner), ct);
        var (all, tables, views) = await repo.CountBySourceTypeAsync(owner, ct);
        var usage = await repo.CountChartUsageAsync(items.Select(i => i.Id).ToList(), ct);
        var owners = q.IsAdmin ? await OwnerNamesAsync(q.TenantId, items, ct) : null;
        var dtos = items.Select(m => DaxModelMapping.ToDto(m, usage.GetValueOrDefault(m.Id),
            owners is null ? null : m.CreatedBy is long id ? owners.GetValueOrDefault(id, "Unknown") : "Unknown")).ToList();
        return new DaxModelPageDto(dtos, total, all, tables, views);
    }

    /// <summary>Creator names for the admin view. The list still loads when the control plane is down (names show as Unknown).</summary>
    private async Task<IReadOnlyDictionary<long, string>> OwnerNamesAsync(long tenantId, IReadOnlyList<SavedDaxModel> items, CancellationToken ct)
    {
        var ids = items.Select(m => m.CreatedBy).OfType<long>().Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<long, string>();
        try
        {
            var users = await directory.ResolveAsync(tenantId, ids, [], ct);
            return users.GroupBy(u => u.UserId).ToDictionary(g => g.Key, g => g.First().Name ?? g.First().Email);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            return new Dictionary<long, string>();
        }
    }
}
