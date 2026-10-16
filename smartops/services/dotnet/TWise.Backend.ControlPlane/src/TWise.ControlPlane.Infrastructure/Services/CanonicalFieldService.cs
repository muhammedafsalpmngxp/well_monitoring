using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class CanonicalFieldService(IGenericRepository<CanonicalField> repo) : ICanonicalFieldService
{
    private static CanonicalFieldDto ToDto(CanonicalField e) =>
        new(e.CanonicalFieldId, e.CanonicalEntityId, e.FieldName, e.DataType,
            e.IsRequired, e.IsUnique, e.ReferenceEntityId, e.Description, e.IsActive);

    public async Task<PagedResult<CanonicalFieldDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<CanonicalFieldDto>(
            paged.Items.Select(ToDto).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<CanonicalFieldDto?> GetAsync(int id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : ToDto(e);
    }

    public async Task<CanonicalFieldDto> CreateAsync(CanonicalFieldCreateRequest request, CancellationToken ct)
    {
        var entity = new CanonicalField
        {
            CanonicalEntityId = request.CanonicalEntityId,
            FieldName = request.FieldName,
            DataType = request.DataType,
            IsRequired = request.IsRequired,
            IsUnique = request.IsUnique,
            ReferenceEntityId = request.ReferenceEntityId,
            Description = request.Description,
            IsActive = request.IsActive
        };
        var e = await repo.AddAsync(entity, ct);
        return ToDto(e);
    }

    public async Task<IReadOnlyList<CanonicalFieldDto>> BulkCreateAsync(IReadOnlyList<CanonicalFieldCreateRequest> items, CancellationToken ct)
    {
        var entities = items.Select(r => new CanonicalField
        {
            CanonicalEntityId = r.CanonicalEntityId,
            FieldName = r.FieldName,
            DataType = r.DataType,
            IsRequired = r.IsRequired,
            IsUnique = r.IsUnique,
            ReferenceEntityId = r.ReferenceEntityId,
            Description = r.Description,
            IsActive = r.IsActive
        });
        var created = await repo.AddRangeAsync(entities, ct);
        return created.Select(ToDto).ToList();
    }

    public async Task<bool> UpdateAsync(int id, CanonicalFieldUpdateRequest request, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;
        e.CanonicalEntityId = request.CanonicalEntityId;
        e.FieldName = request.FieldName;
        e.DataType = request.DataType;
        e.IsRequired = request.IsRequired;
        e.IsUnique = request.IsUnique;
        e.ReferenceEntityId = request.ReferenceEntityId;
        e.Description = request.Description;
        e.IsActive = request.IsActive;
        return await repo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> BulkUpdateAsync(IReadOnlyList<BulkCanonicalFieldUpdateItem> items, CancellationToken ct)
    {
        var updates = new Dictionary<object, CanonicalField>();
        foreach (var item in items)
        {
            updates[(object)item.CanonicalFieldId] = new CanonicalField
            {
                CanonicalFieldId = item.CanonicalFieldId,
                CanonicalEntityId = item.CanonicalEntityId,
                FieldName = item.FieldName,
                DataType = item.DataType,
                IsRequired = item.IsRequired,
                IsUnique = item.IsUnique,
                ReferenceEntityId = item.ReferenceEntityId,
                Description = item.Description,
                IsActive = item.IsActive
            };
        }
        return await repo.UpdateRangeAsync(updates, ct);
    }

    public Task<bool> DeleteAsync(int id, CancellationToken ct) => repo.DeleteAsync(id, ct);
}
