using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface IFieldMappingService
{
    Task<PagedResult<FieldMappingDto>> ListAsync(int page, int pageSize, CancellationToken ct);
    Task<FieldMappingDto?> GetAsync(long id, CancellationToken ct);
    Task<FieldMappingDto> CreateAsync(FieldMappingCreateRequest request, CancellationToken ct);
    Task<IReadOnlyList<FieldMappingDto>> BulkCreateAsync(IReadOnlyList<FieldMappingCreateRequest> items, CancellationToken ct);
    Task<bool> UpdateAsync(long id, FieldMappingUpdateRequest request, CancellationToken ct);
    Task<bool> BulkUpdateAsync(IReadOnlyList<BulkFieldMappingUpdateItem> items, CancellationToken ct);
    Task<bool> DeleteAsync(long id, CancellationToken ct);
}
