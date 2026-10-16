namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A comment or reply (when ParentCommentId is set) attached to a dashboard/report/widget.
/// TargetType/TargetId identify the owning item (e.g. "Dashboard" + DashboardId).
/// </summary>
public class Comment
{
    public long CommentId { get; set; }
    public string TargetType { get; set; } = string.Empty;
    public int TargetId { get; set; }

    /// <summary>Null = top-level comment; set = a reply to that CommentId.</summary>
    public long? ParentCommentId { get; set; }

    public long UserId { get; set; }
    /// <summary>Snapshot of the author's name at post time (Tenant DB has no local Users table to join).</summary>
    public string AuthorDisplayName { get; set; } = string.Empty;

    public string Body { get; set; } = string.Empty;
    /// <summary>JSON array of userIds mentioned via @ in Body, e.g. "[12,45]".</summary>
    public string? MentionedUserIdsJson { get; set; }

    public bool IsDeleted { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ModifiedAt { get; set; }
}
