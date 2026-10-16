using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class CanonicalEntityService(IGenericRepository<CanonicalEntity> repo) : ICanonicalEntityService
{
    public async Task<PagedResult<CanonicalEntityDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<CanonicalEntityDto>(
            paged.Items.Select(e => new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<CanonicalEntityDto?> GetAsync(int id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive);
    }

    public async Task<CanonicalEntityDto> CreateAsync(CanonicalEntityCreateRequest request, CancellationToken ct)
    {
        var entity = new CanonicalEntity
        {
            EntityName = request.EntityName,
            SchemaVersionId = request.SchemaVersionId,
            Layer = request.Layer,
            Description = request.Description,
            IsActive = request.IsActive
        };
        var e = await repo.AddAsync(entity, ct);
        return new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive);
    }

    public async Task<IReadOnlyList<CanonicalEntityDto>> BulkCreateAsync(IReadOnlyList<CanonicalEntityCreateRequest> items, CancellationToken ct)
    {
        var entities = items.Select(r => new CanonicalEntity
        {
            EntityName = r.EntityName,
            SchemaVersionId = r.SchemaVersionId,
            Layer = r.Layer,
            Description = r.Description,
            IsActive = r.IsActive
        });
        var created = await repo.AddRangeAsync(entities, ct);
        return created.Select(e => new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive)).ToList();
    }

    public async Task<bool> UpdateAsync(int id, CanonicalEntityUpdateRequest request, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;
        e.EntityName = request.EntityName;
        e.SchemaVersionId = request.SchemaVersionId;
        e.Layer = request.Layer;
        e.Description = request.Description;
        e.IsActive = request.IsActive;
        return await repo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> BulkUpdateAsync(IReadOnlyList<BulkCanonicalEntityUpdateItem> items, CancellationToken ct)
    {
        var updates = new Dictionary<object, CanonicalEntity>();
        foreach (var item in items)
        {
            updates[(object)item.CanonicalEntityId] = new CanonicalEntity
            {
                CanonicalEntityId = item.CanonicalEntityId,
                EntityName = item.EntityName,
                SchemaVersionId = item.SchemaVersionId,
                Layer = item.Layer,
                Description = item.Description,
                IsActive = item.IsActive
            };
        }
        return await repo.UpdateRangeAsync(updates, ct);
    }

    public Task<bool> DeleteAsync(int id, CancellationToken ct) => repo.DeleteAsync(id, ct);
}
