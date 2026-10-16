using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class LearnVideoRepository(TenantDbContext db) : ILearnVideoRepository
{
    public Task<LearnVideo?> GetByScreenAsync(string screenKey, CancellationToken ct = default)
        => db.LearnVideos.AsNoTracking()
            .Where(v => v.ScreenKey == screenKey && v.IsActive)
            .OrderByDescending(v => v.ModifiedAt)
            .FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<LearnVideo>> GetAllAsync(CancellationToken ct = default)
        => await db.LearnVideos.AsNoTracking().OrderBy(v => v.ScreenKey).ToListAsync(ct);

    public async Task<LearnVideo> UpsertAsync(LearnVideo video, CancellationToken ct = default)
    {
        var existing = await db.LearnVideos.FirstOrDefaultAsync(v => v.ScreenKey == video.ScreenKey, ct);
        if (existing is null)
        {
            db.LearnVideos.Add(video);
            await db.SaveChangesAsync(ct);
            return video;
        }
        existing.Title = video.Title;
        existing.VideoUrl = video.VideoUrl;
        existing.PosterUrl = video.PosterUrl;
        existing.ChaptersJson = video.ChaptersJson;
        existing.IsActive = video.IsActive;
        existing.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return existing;
    }
}
