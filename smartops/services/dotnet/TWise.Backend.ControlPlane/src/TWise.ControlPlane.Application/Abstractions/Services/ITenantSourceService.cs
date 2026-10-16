using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ITenantSourceService
{
    Task<PagedResult<TenantSourceDto>> ListAsync(int page, int pageSize, CancellationToken ct);
    Task<TenantSourceDto?> GetAsync(long id, CancellationToken ct);
    Task<TenantSourceDto> CreateAsync(TenantSourceCreateRequest request, CancellationToken ct);
    Task<bool> UpdateAsync(long id, TenantSourceUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteAsync(long id, CancellationToken ct);
}
