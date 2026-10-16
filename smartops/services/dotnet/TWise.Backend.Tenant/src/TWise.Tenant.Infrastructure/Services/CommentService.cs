using System.Text.Json;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class CommentService(
    ICommentRepository repo,
    IControlPlaneNotificationClient notifications,
    ILogger<CommentService> logger) : ICommentService
{
    public async Task<IReadOnlyList<CommentDto>> GetThreadAsync(string targetType, int targetId, CancellationToken ct = default)
    {
        var all = await repo.GetThreadAsync(targetType, targetId, ct);
        var byId = all.ToDictionary(c => c.CommentId, ToDto);
        var roots = new List<CommentDto>();

        // Single flat query, nested in memory: replies are 1 level deep so a dictionary lookup is enough.
        foreach (var c in all)
        {
            var dto = byId[c.CommentId];
            if (c.ParentCommentId is { } parentId && byId.TryGetValue(parentId, out var parent))
                parent.Replies.Add(dto);
            else
                roots.Add(dto);
        }

        return roots;
    }

    public async Task<CommentDto> CreateAsync(
        long tenantId, long userId, string authorDisplayName, CreateCommentRequest request, CancellationToken ct = default)
    {
        var mentionedUserIds = (request.MentionedUserIds ?? new List<long>()).Distinct().ToList();

        var comment = new Comment
        {
            TargetType = request.TargetType,
            TargetId = request.TargetId,
            ParentCommentId = request.ParentCommentId,
            UserId = userId,
            AuthorDisplayName = authorDisplayName,
            Body = request.Body.Trim(),
            MentionedUserIdsJson = mentionedUserIds.Count > 0 ? JsonSerializer.Serialize(mentionedUserIds) : null,
        };

        await repo.AddAsync(comment, ct);
        logger.LogInformation("Comment {CommentId} posted on {TargetType} {TargetId} by user {UserId}.",
            comment.CommentId, comment.TargetType, comment.TargetId, userId);

        // Reply notification: let the parent comment's author know, unless they replied to themselves.
        if (request.ParentCommentId is { } parentId)
        {
            var parent = await repo.GetByIdAsync(parentId, ct);
            if (parent is not null && parent.UserId != userId)
            {
                await notifications.PublishAsync(tenantId, "CommentReply", $"{authorDisplayName} replied to your comment",
                    Truncate(comment.Body), BuildRoute(request.TargetType, request.TargetId, comment.CommentId), new[] { parent.UserId }, null, ct);
            }
        }

        // Mention notifications, excluding the author themselves (self-mentions don't need a notification).
        var mentionRecipients = mentionedUserIds.Where(id => id != userId).ToList();
        if (mentionRecipients.Count > 0)
        {
            await notifications.PublishAsync(tenantId, "CommentMention", $"{authorDisplayName} mentioned you in a comment",
                Truncate(comment.Body), BuildRoute(request.TargetType, request.TargetId, comment.CommentId), mentionRecipients, null, ct);
        }

        return ToDto(comment);
    }

    public async Task<bool> DeleteAsync(long commentId, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var comment = await repo.GetByIdAsync(commentId, ct);
        if (comment is null || comment.IsDeleted) return false;
        if (!isAdmin && comment.UserId != userId) return false;

        await repo.SoftDeleteAsync(comment, ct);
        return true;
    }

    private static string Truncate(string body) => body.Length > 120 ? body[..120] + "…" : body;

    private static string BuildRoute(string targetType, int targetId, long commentId) => targetType switch
    {
        "Dashboard" => $"/dashboard/operations-dashboard/{targetId}?openComments=1&commentId={commentId}",
        "Canvas" => $"/canvas/{targetId}?openComments=1&commentId={commentId}",
        _ => "/"
    };

    private static CommentDto ToDto(Comment c) => new()
    {
        CommentId = c.CommentId,
        ParentCommentId = c.ParentCommentId,
        UserId = c.UserId,
        AuthorDisplayName = c.AuthorDisplayName,
        Body = c.Body,
        MentionedUserIds = string.IsNullOrEmpty(c.MentionedUserIdsJson)
            ? Array.Empty<long>()
            : JsonSerializer.Deserialize<List<long>>(c.MentionedUserIdsJson) ?? new List<long>(),
        // EF Core round-trips DateTime as Kind=Unspecified even though CreatedAt is written via DateTime.UtcNow —
        // must re-tag Utc here or the frontend's `new Date(iso)` misreads it as local time (see repo notes).
        CreatedAt = DateTime.SpecifyKind(c.CreatedAt, DateTimeKind.Utc),
    };
}
