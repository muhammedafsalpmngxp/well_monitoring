using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class UserPreferenceService(IUserPreferenceRepository repo) : IUserPreferenceService
{
    public async Task<UserPreferenceDto> ToggleFavouriteAsync(
        long userId, int controlTypeId, long controlId, CancellationToken ct = default)
    {
        var pref = await repo.ToggleFavouriteAsync(userId, controlTypeId, controlId, ct);
        return ToDto(pref);
    }

    public Task TrackViewAsync(
        long userId, int controlTypeId, long controlId, CancellationToken ct = default)
        => repo.TrackViewAsync(userId, controlTypeId, controlId, ct);

    public async Task<IReadOnlyList<UserPreferenceDto>> GetFavouritesAsync(
        long userId, int? controlTypeId, CancellationToken ct = default)
    {
        var prefs = await repo.GetFavouritesAsync(userId, controlTypeId, ct);
        return prefs.Select(ToDto).ToList();
    }

    public async Task<IReadOnlyList<UserPreferenceDto>> GetRecentlyViewedAsync(
        long userId, int? controlTypeId, int limit, CancellationToken ct = default)
    {
        var prefs = await repo.GetRecentlyViewedAsync(userId, controlTypeId, limit, ct);
        return prefs.Select(ToDto).ToList();
    }

    private static UserPreferenceDto ToDto(UserPreference p) => new(
        p.PreferenceId, p.UserId, p.ControlTypeId, p.ControlId, p.IsFavourite, p.LastViewedOn);
}
