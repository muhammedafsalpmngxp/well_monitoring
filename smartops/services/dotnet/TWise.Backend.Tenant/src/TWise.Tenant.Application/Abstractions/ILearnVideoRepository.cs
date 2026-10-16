using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface ILearnVideoRepository
{
    /// <summary>The active video for a screen, or null when none is configured.</summary>
    Task<LearnVideo?> GetByScreenAsync(string screenKey, CancellationToken ct = default);

    /// <summary>Every configured video, active or not, for the admin screen.</summary>
    Task<IReadOnlyList<LearnVideo>> GetAllAsync(CancellationToken ct = default);

    /// <summary>Inserts, or updates the row with the same ScreenKey.</summary>
    Task<LearnVideo> UpsertAsync(LearnVideo video, CancellationToken ct = default);
}
