namespace TWise.Tenant.Domain.DTOs;

public record LearnChapterDto(string Id, string Label, int Time, string DurationLabel);

/// <summary>The Learn video for one screen, with its chapter markers.</summary>
public record LearnVideoDto(
    string ScreenKey, string Title, string VideoUrl, string? PosterUrl, IReadOnlyList<LearnChapterDto> Chapters,
    bool IsActive = true, DateTime? ModifiedAt = null);

/// <summary>Creates or replaces the video for a screen. VideoUrl/PosterUrl must be absolute https URLs (e.g. S3 object URLs).</summary>
public record SaveLearnVideoRequest(string Title, string VideoUrl, string? PosterUrl, IReadOnlyList<LearnChapterDto>? Chapters, bool IsActive = true);
