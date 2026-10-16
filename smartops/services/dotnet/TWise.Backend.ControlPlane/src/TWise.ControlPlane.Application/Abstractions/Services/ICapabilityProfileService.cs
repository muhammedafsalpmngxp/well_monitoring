using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ICapabilityProfileService
{
    Task<PagedResult<CapabilityProfileDto>> ListAsync(int page, int pageSize, CancellationToken ct);
    Task<CapabilityProfileDto?> GetAsync(long id, CancellationToken ct);
    Task<CapabilityProfileDto> CreateAsync(CapabilityProfileCreateRequest request, CancellationToken ct);
    Task<bool> UpdateAsync(long id, CapabilityProfileUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteAsync(long id, CancellationToken ct);
}
