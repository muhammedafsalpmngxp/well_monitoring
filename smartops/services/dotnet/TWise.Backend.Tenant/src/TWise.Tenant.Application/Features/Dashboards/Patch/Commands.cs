using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Dashboards;

public record ToggleDashboardActiveCommand(int DashboardId) : IRequest<Result<ToggleDashboardActiveResponse>>;

public record PatchDashboardLayoutCommand(int DashboardId, string ConfigJson) : IRequest<Result<PatchDashboardLayoutResponse>>;
