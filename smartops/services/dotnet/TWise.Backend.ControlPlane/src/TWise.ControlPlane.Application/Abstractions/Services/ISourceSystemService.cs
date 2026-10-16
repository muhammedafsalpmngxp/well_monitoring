using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ISourceSystemService
{
    Task<PagedResult<SourceSystemDto>> ListAsync(int page, int pageSize, CancellationToken ct);
    Task<SourceSystemDto?> GetAsync(int id, CancellationToken ct);
    Task<SourceSystemDto> CreateAsync(SourceSystemCreateRequest request, CancellationToken ct);
    Task<bool> UpdateAsync(int id, SourceSystemUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteAsync(int id, CancellationToken ct);
}
