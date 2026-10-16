using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface ICommentRepository
{
    Task<IReadOnlyList<Comment>> GetThreadAsync(string targetType, int targetId, CancellationToken ct = default);
    Task<Comment> AddAsync(Comment comment, CancellationToken ct = default);
    Task<Comment?> GetByIdAsync(long commentId, CancellationToken ct = default);
    Task SoftDeleteAsync(Comment comment, CancellationToken ct = default);
}
