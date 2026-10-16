using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ICanonicalEntityService
{
    Task<PagedResult<CanonicalEntityDto>> ListAsync(int page, int pageSize, CancellationToken ct);
    Task<CanonicalEntityDto?> GetAsync(int id, CancellationToken ct);
    Task<CanonicalEntityDto> CreateAsync(CanonicalEntityCreateRequest request, CancellationToken ct);
    Task<IReadOnlyList<CanonicalEntityDto>> BulkCreateAsync(IReadOnlyList<CanonicalEntityCreateRequest> items, CancellationToken ct);
    Task<bool> UpdateAsync(int id, CanonicalEntityUpdateRequest request, CancellationToken ct);
    Task<bool> BulkUpdateAsync(IReadOnlyList<BulkCanonicalEntityUpdateItem> items, CancellationToken ct);
    Task<bool> DeleteAsync(int id, CancellationToken ct);
}
