using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class CommentRepository(TenantDbContext db) : ICommentRepository
{
    public async Task<IReadOnlyList<Comment>> GetThreadAsync(string targetType, int targetId, CancellationToken ct = default)
    {
        return await db.Comments.AsNoTracking()
            .Where(c => c.TargetType == targetType && c.TargetId == targetId && !c.IsDeleted)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<Comment> AddAsync(Comment comment, CancellationToken ct = default)
    {
        db.Comments.Add(comment);
        await db.SaveChangesAsync(ct);
        return comment;
    }

    public Task<Comment?> GetByIdAsync(long commentId, CancellationToken ct = default)
        => db.Comments.FirstOrDefaultAsync(c => c.CommentId == commentId, ct);

    public async Task SoftDeleteAsync(Comment comment, CancellationToken ct = default)
    {
        comment.IsDeleted = true;
        comment.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }
}
