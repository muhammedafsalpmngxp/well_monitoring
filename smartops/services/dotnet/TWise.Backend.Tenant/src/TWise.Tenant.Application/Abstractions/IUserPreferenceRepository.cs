using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IUserPreferenceRepository
{
    /// <summary>Toggle IsFavourite for the given user/control. Creates a row if none exists.</summary>
    Task<UserPreference> ToggleFavouriteAsync(long userId, int controlTypeId, long controlId, CancellationToken ct = default);

    /// <summary>Update (or create) the LastViewedOn timestamp for the given user/control.</summary>
    Task TrackViewAsync(long userId, int controlTypeId, long controlId, CancellationToken ct = default);

    /// <summary>Return all favourite rows for the user (optionally filtered by controlTypeId).</summary>
    Task<IReadOnlyList<UserPreference>> GetFavouritesAsync(long userId, int? controlTypeId, CancellationToken ct = default);

    /// <summary>Return the N most recently viewed rows for the user (optionally filtered by controlTypeId).</summary>
    Task<IReadOnlyList<UserPreference>> GetRecentlyViewedAsync(long userId, int? controlTypeId, int limit, CancellationToken ct = default);

    /// <summary>Get a single preference row (or null).</summary>
    Task<UserPreference?> GetAsync(long userId, int controlTypeId, long controlId, CancellationToken ct = default);
}
