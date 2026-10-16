using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IUserPreferenceService
{
    Task<UserPreferenceDto>              ToggleFavouriteAsync(long userId, int controlTypeId, long controlId, CancellationToken ct = default);
    Task                                 TrackViewAsync      (long userId, int controlTypeId, long controlId, CancellationToken ct = default);
    Task<IReadOnlyList<UserPreferenceDto>> GetFavouritesAsync   (long userId, int? controlTypeId, CancellationToken ct = default);
    Task<IReadOnlyList<UserPreferenceDto>> GetRecentlyViewedAsync(long userId, int? controlTypeId, int limit, CancellationToken ct = default);
}
