using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class FieldMappingService(IGenericRepository<FieldMapping> repo) : IFieldMappingService
{
    public async Task<PagedResult<FieldMappingDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<FieldMappingDto>(
            paged.Items.Select(e => new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<FieldMappingDto?> GetAsync(long id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive);
    }

    public async Task<FieldMappingDto> CreateAsync(FieldMappingCreateRequest request, CancellationToken ct)
    {
        var entity = new FieldMapping
        {
            TenantSourceId = request.TenantSourceId,
            CanonicalFieldId = request.CanonicalFieldId,
            SourceObject = request.SourceObject,
            SourceField = request.SourceField,
            TransformRule = request.TransformRule,
            IsActive = request.IsActive
        };
        var e = await repo.AddAsync(entity, ct);
        return new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive);
    }

    public async Task<IReadOnlyList<FieldMappingDto>> BulkCreateAsync(IReadOnlyList<FieldMappingCreateRequest> items, CancellationToken ct)
    {
        var entities = items.Select(r => new FieldMapping
        {
            TenantSourceId = r.TenantSourceId,
            CanonicalFieldId = r.CanonicalFieldId,
            SourceObject = r.SourceObject,
            SourceField = r.SourceField,
            TransformRule = r.TransformRule,
            IsActive = r.IsActive
        });
        var created = await repo.AddRangeAsync(entities, ct);
        return created.Select(e => new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive)).ToList();
    }

    public async Task<bool> UpdateAsync(long id, FieldMappingUpdateRequest request, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;
        e.TenantSourceId = request.TenantSourceId;
        e.CanonicalFieldId = request.CanonicalFieldId;
        e.SourceObject = request.SourceObject;
        e.SourceField = request.SourceField;
        e.TransformRule = request.TransformRule;
        e.IsActive = request.IsActive;
        return await repo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> BulkUpdateAsync(IReadOnlyList<BulkFieldMappingUpdateItem> items, CancellationToken ct)
    {
        var updates = new Dictionary<object, FieldMapping>();
        foreach (var item in items)
        {
            updates[(object)item.FieldMappingId] = new FieldMapping
            {
                FieldMappingId = item.FieldMappingId,
                TenantSourceId = item.TenantSourceId,
                CanonicalFieldId = item.CanonicalFieldId,
                SourceObject = item.SourceObject,
                SourceField = item.SourceField,
                TransformRule = item.TransformRule,
                IsActive = item.IsActive
            };
        }
        return await repo.UpdateRangeAsync(updates, ct);
    }

    public Task<bool> DeleteAsync(long id, CancellationToken ct) => repo.DeleteAsync(id, ct);
}
