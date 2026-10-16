using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class WidgetLibraryService(
    IGenericRepository<WidgetLibrary> repo) : IWidgetLibraryService
{
    public async Task<IReadOnlyList<WidgetLibraryDto>> ListAsync(string? type, CancellationToken ct)
    {
        var all = await repo.GetAllAsync(ct);
        var filtered = type is null
            ? all
            : all.Where(w => w.Type.Equals(type, StringComparison.OrdinalIgnoreCase)).ToList();
        return filtered.Select(ToDto).ToList();
    }

    public async Task<WidgetLibraryDto?> GetAsync(int id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : ToDto(e);
    }

    public async Task<WidgetLibraryDto> CreateAsync(
        CreateWidgetLibraryRequest request, long userId, CancellationToken ct)
    {
        var entity = new WidgetLibrary
        {
            WidgetName = request.WidgetName,
            Type       = request.Type,
            Json       = request.Json,
            CreatedBy  = userId,
            CreatedAt  = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow,
            IsDeleted  = false
        };
        var saved = await repo.AddAsync(entity, ct);
        return ToDto(saved);
    }

    public async Task<bool> UpdateAsync(
        int id, UpdateWidgetLibraryRequest request, long userId, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;

        e.WidgetName  = request.WidgetName;
        e.Type        = request.Type;
        e.Json        = request.Json;
        e.ModifiedBy  = userId;
        e.ModifiedAt  = DateTime.UtcNow;

        return await repo.UpdateAsync(id, e, ct);
    }

    public Task<bool> DeleteAsync(int id, CancellationToken ct)
        => repo.DeleteAsync(id, ct);

    private static WidgetLibraryDto ToDto(WidgetLibrary e) => new(
        e.Id, e.WidgetName, e.Type, e.Json,
        e.CreatedBy, e.CreatedAt, e.ModifiedBy, e.ModifiedAt);
}
