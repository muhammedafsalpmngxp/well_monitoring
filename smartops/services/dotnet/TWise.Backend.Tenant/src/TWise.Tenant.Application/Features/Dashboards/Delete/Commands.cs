using MediatR;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Dashboards;

public record DeleteDashboardCommand(int DashboardId) : IRequest<Result>;
