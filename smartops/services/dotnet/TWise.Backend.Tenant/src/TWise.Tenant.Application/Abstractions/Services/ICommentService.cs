using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface ICommentService
{
    Task<IReadOnlyList<CommentDto>> GetThreadAsync(string targetType, int targetId, CancellationToken ct = default);

    Task<CommentDto> CreateAsync(
        long tenantId, long userId, string authorDisplayName, CreateCommentRequest request, CancellationToken ct = default);

    Task<bool> DeleteAsync(long commentId, long userId, bool isAdmin, CancellationToken ct = default);
}
