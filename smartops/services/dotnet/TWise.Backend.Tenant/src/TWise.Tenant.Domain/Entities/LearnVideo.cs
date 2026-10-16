namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// The "Learn" video shown on a builder screen. The file itself lives in object storage (an S3
/// URL); only its location and chapter markers are kept here, so videos can be replaced without a
/// deployment. One active row per screen. Maps to [core].[LearnVideos].
/// </summary>
public class LearnVideo
{
    public long Id { get; set; }

    /// <summary>Which screen the video belongs to, e.g. "chart-builder", "report-builder".</summary>
    public string ScreenKey { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    /// <summary>Absolute https URL of the MP4 (S3 object URL or CloudFront).</summary>
    public string VideoUrl { get; set; } = string.Empty;

    public string? PosterUrl { get; set; }

    /// <summary>JSON array of { id, label, time (seconds), durationLabel } for the Quick Chapters row.</summary>
    public string? ChaptersJson { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
