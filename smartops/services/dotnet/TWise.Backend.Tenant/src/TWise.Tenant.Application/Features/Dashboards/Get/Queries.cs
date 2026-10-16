using MediatR;
using System.Security.Claims;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Dashboards;

// ─── Queries ─────────────────────────────────────────────────────────────────

/// <summary>Kind is dashboard (the default when null) or canvas; see DashboardKind.</summary>
public record GetWipDashboardsQuery(string? Kind = null) : IRequest<Result<IReadOnlyList<DashboardCategoryResponse>>>;

/// <summary>Minimal list of the current user's WIP dashboards (id + name) for the copy-chart picker. Kind as for GetWipDashboardsQuery.</summary>
public record GetWipDashboardsMinimalQuery(string? Kind = null) : IRequest<Result<IReadOnlyList<DashboardMinimalResponse>>>;

/// <summary>Kind as for GetWipDashboardsQuery.</summary>
public record GetPublishedDashboardsQuery(string? Kind = null) : IRequest<Result<IReadOnlyList<DashboardCategoryResponse>>>;

public record GetDashboardByIdQuery(int DashboardId) : IRequest<Result<DashboardDetailResponse>>;

public record GetSharedDashboardQuery(int DashboardId, string Token) : IRequest<Result<DashboardDetailResponse>>;

public record GetSharedDashboardWidgetsQuery(int DashboardId, string Token) : IRequest<Result<WidgetLibraryResponse>>;

/// <summary>Dashboards internally shared with the current user (any status), grouped by category.</summary>
public record GetSharedWithMeDashboardsQuery(string? Kind = null) : IRequest<Result<IReadOnlyList<DashboardCategoryResponse>>>;

/// <summary>Widgets referenced by a specific dashboard (any authenticated user, no ownership filter — lets a dashboard shared with another user render its charts/tiles even if they are the sharer's own drafts).</summary>
public record GetDashboardWidgetsQuery(int DashboardId) : IRequest<Result<WidgetLibraryResponse>>;

public record GetDashboardVersionHistoryQuery(int DashboardId) : IRequest<Result<IReadOnlyList<DashboardVersionSummaryResponse>>>;

public record GetWidgetLibraryQuery : IRequest<Result<WidgetLibraryResponse>>;

public record CheckDashboardCommentAccessQuery(ClaimsPrincipal User, char Action, string? TargetType,
	int TargetId, long? CommentId, CreateCommentRequest? Create) : IRequest<Result>;

public record ResolveDashboardVersionAccessQuery(ClaimsPrincipal User, int DashboardId,
	bool IsHistoryRequest) : IRequest<Result<DashboardVersionAccess>>;
