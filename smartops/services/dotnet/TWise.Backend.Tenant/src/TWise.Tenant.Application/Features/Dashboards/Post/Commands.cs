using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Dashboards;

// ─── Commands ────────────────────────────────────────────────────────────────

public record CreateDashboardCommand(SaveDashboardRequest Request) : IRequest<Result<CreateDashboardResponse>>;

public record PublishDashboardCommand(int DashboardId) : IRequest<Result<PublishDashboardResponse>>;

public record UnpublishDashboardCommand(int DashboardId) : IRequest<Result<PublishDashboardResponse>>;

public record CompleteDashboardCommand(int DashboardId) : IRequest<Result<CompleteDashboardResponse>>;

/// <summary>
/// Move a Completed dashboard back to Draft (non-admin "My Boards" reopen action).
/// </summary>
public record ReopenDashboardCommand(int DashboardId) : IRequest<Result<ReopenDashboardResponse>>;

/// <summary>
/// Copy a published dashboard into a new Draft dashboard (same category/description/widget layout).
/// </summary>
public record CopyDashboardToDraftCommand(int DashboardId) : IRequest<Result<CreateDashboardResponse>>;

/// <summary>
/// Restores a previously published version. Append-only: the chosen version's content is
/// republished as a NEW version, so history is preserved rather than rewritten.
/// </summary>
/// <param name="DashboardId">Any dashboard in the series — used to locate the series.</param>
/// <param name="VersionNo">The published version number to restore from.</param>
public record RestoreDashboardVersionCommand(int DashboardId, int VersionNo)
    : IRequest<Result<RestoreDashboardVersionResponse>>;

public record CreateDashboardShareLinkCommand(int DashboardId) : IRequest<Result<DashboardShareLinkResponse>>;

/// <summary>
/// Share a dashboard with specific tenant users (internal share) — shows up under their "Shared" tab.
/// </summary>
public record ShareDashboardInternallyCommand(int DashboardId, IReadOnlyList<long> UserIds, long TenantId) : IRequest<Result<ShareDashboardInternallyResponse>>;
