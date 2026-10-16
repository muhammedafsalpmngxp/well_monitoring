using System.Text.Json;
using System.Text.RegularExpressions;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.LearnVideos;

public sealed record GetLearnVideoQuery(string ScreenKey) : IRequest<LearnVideoDto?>;
public sealed record ListLearnVideosQuery : IRequest<IReadOnlyList<LearnVideoDto>>;
public sealed record SaveLearnVideoCommand(string ScreenKey, SaveLearnVideoRequest Request) : IRequest<LearnVideoDto>;

internal static class LearnVideoMapping
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    public static LearnVideoDto ToDto(LearnVideo video)
    {
        List<LearnChapterDto> chapters = [];
        if (!string.IsNullOrWhiteSpace(video.ChaptersJson))
        {
            // A malformed chapter list must not hide the video; the player still works without chapters.
            try { chapters = JsonSerializer.Deserialize<List<LearnChapterDto>>(video.ChaptersJson, Json) ?? []; }
            catch (JsonException) { chapters = []; }
        }
        return new LearnVideoDto(video.ScreenKey, video.Title, video.VideoUrl, video.PosterUrl, chapters, video.IsActive, video.ModifiedAt);
    }
}

public sealed class GetLearnVideoHandler(ILearnVideoRepository repo) : IRequestHandler<GetLearnVideoQuery, LearnVideoDto?>
{
    public async Task<LearnVideoDto?> Handle(GetLearnVideoQuery request, CancellationToken ct)
    {
        var video = await repo.GetByScreenAsync(request.ScreenKey.Trim().ToLowerInvariant(), ct);
        return video is null ? null : LearnVideoMapping.ToDto(video);
    }
}

public sealed class ListLearnVideosHandler(ILearnVideoRepository repo) : IRequestHandler<ListLearnVideosQuery, IReadOnlyList<LearnVideoDto>>
{
    public async Task<IReadOnlyList<LearnVideoDto>> Handle(ListLearnVideosQuery request, CancellationToken ct)
        => (await repo.GetAllAsync(ct)).Select(LearnVideoMapping.ToDto).ToList();
}

public sealed partial class SaveLearnVideoHandler(ILearnVideoRepository repo) : IRequestHandler<SaveLearnVideoCommand, LearnVideoDto>
{
    [GeneratedRegex("^[a-z][a-z0-9-]{1,48}$")]
    private static partial Regex ScreenKeyPattern();

    public async Task<LearnVideoDto> Handle(SaveLearnVideoCommand command, CancellationToken ct)
    {
        var key = command.ScreenKey.Trim().ToLowerInvariant();
        if (!ScreenKeyPattern().IsMatch(key))
            throw new InvalidOperationException("Screen key must be lower-case letters, digits and hyphens (e.g. chart-builder).");

        var r = command.Request;
        var title = (r.Title ?? "").Trim();
        if (title.Length == 0) throw new InvalidOperationException("A title is required.");

        // The browser loads these directly, so they must be absolute https URLs (S3 object or CloudFront).
        var videoUrl = RequireHttps(r.VideoUrl, "Video URL");
        var posterUrl = string.IsNullOrWhiteSpace(r.PosterUrl) ? null : RequireHttps(r.PosterUrl, "Poster URL");

        var chapters = (r.Chapters ?? [])
            .Where(c => !string.IsNullOrWhiteSpace(c.Label))
            .Select((c, i) => new LearnChapterDto(
                string.IsNullOrWhiteSpace(c.Id) ? $"chapter-{i + 1}" : c.Id.Trim(), c.Label.Trim(), Math.Max(0, c.Time), (c.DurationLabel ?? "").Trim()))
            .ToList();

        var saved = await repo.UpsertAsync(new LearnVideo
        {
            ScreenKey = key, Title = title, VideoUrl = videoUrl, PosterUrl = posterUrl,
            ChaptersJson = JsonSerializer.Serialize(chapters, LearnVideoMapping.Json), IsActive = r.IsActive,
        }, ct);
        return LearnVideoMapping.ToDto(saved);
    }

    private static string RequireHttps(string? value, string name)
    {
        if (!Uri.TryCreate((value ?? "").Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException($"{name} must be an absolute https:// address.");
        return uri.ToString();
    }
}
