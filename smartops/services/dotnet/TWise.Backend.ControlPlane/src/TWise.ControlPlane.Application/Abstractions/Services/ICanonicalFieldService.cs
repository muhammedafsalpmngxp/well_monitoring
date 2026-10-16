using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ICanonicalFieldService
{
    Task<PagedResult<CanonicalFieldDto>> ListAsync(int page, int pageSize, CancellationToken ct);
    Task<CanonicalFieldDto?> GetAsync(int id, CancellationToken ct);
    Task<CanonicalFieldDto> CreateAsync(CanonicalFieldCreateRequest request, CancellationToken ct);
    Task<IReadOnlyList<CanonicalFieldDto>> BulkCreateAsync(IReadOnlyList<CanonicalFieldCreateRequest> items, CancellationToken ct);
    Task<bool> UpdateAsync(int id, CanonicalFieldUpdateRequest request, CancellationToken ct);
    Task<bool> BulkUpdateAsync(IReadOnlyList<BulkCanonicalFieldUpdateItem> items, CancellationToken ct);
    Task<bool> DeleteAsync(int id, CancellationToken ct);
}
