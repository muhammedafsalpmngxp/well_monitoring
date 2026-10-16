using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface IWidgetLibraryService
{
    Task<IReadOnlyList<WidgetLibraryDto>> ListAsync(string? type, CancellationToken ct);
    Task<WidgetLibraryDto?> GetAsync(int id, CancellationToken ct);
    Task<WidgetLibraryDto> CreateAsync(CreateWidgetLibraryRequest request, long userId, CancellationToken ct);
    Task<bool> UpdateAsync(int id, UpdateWidgetLibraryRequest request, long userId, CancellationToken ct);
    Task<bool> DeleteAsync(int id, CancellationToken ct);
}
