using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Dashboards;

// ─── Update Dashboard (same validation as Create) ────────────────────────────
public record UpdateDashboardCommand(int DashboardId, SaveDashboardRequest Request) : IRequest<Result<UpdateDashboardResponse>>;
