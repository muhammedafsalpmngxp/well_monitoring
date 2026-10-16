namespace TWise.Tenant.Domain.DTOs;

public class CommentDto
{
    public long CommentId { get; set; }
    public long? ParentCommentId { get; set; }
    public long UserId { get; set; }
    public string AuthorDisplayName { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public IReadOnlyList<long> MentionedUserIds { get; set; } = Array.Empty<long>();
    public DateTime CreatedAt { get; set; }
    /// <summary>Only populated one level deep (replies never have their own replies).</summary>
    public List<CommentDto> Replies { get; set; } = new();
}

public class CreateCommentRequest
{
    public string TargetType { get; set; } = string.Empty;
    public int TargetId { get; set; }
    public long? ParentCommentId { get; set; }
    public string Body { get; set; } = string.Empty;
    public List<long>? MentionedUserIds { get; set; }
}
