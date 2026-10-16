using System.Security.Claims;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IDashboardPermissionService
{
    Task<Result> CheckCommentAccessAsync(ClaimsPrincipal user, char action, string? targetType,
        int targetId, long? commentId, CreateCommentRequest? create, CancellationToken ct);

    Task<Result<DashboardVersionAccess>> ResolveVersionAccessAsync(ClaimsPrincipal user,
        int dashboardId, bool isHistoryRequest, CancellationToken ct);
}

public sealed record DashboardVersionAccess(
    int DashboardId, IReadOnlyList<DashboardVersionSummaryResponse>? Versions = null);