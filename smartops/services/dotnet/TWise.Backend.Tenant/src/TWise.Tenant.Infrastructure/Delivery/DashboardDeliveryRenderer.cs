using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>A dashboard is sent as a link to it; drawing it on the server waits for the headless-browser decision.</summary>
public sealed class DashboardDeliveryRenderer(TenantDbContext db, IConfiguration config) : IDeliveryRenderer
{
    public string TargetType => DeliveryTerms.Dashboard;

    public async Task<RenderedDelivery> RenderAsync(Schedule schedule, CancellationToken ct)
    {
        var board = await CanvasDeliveryRenderer.BoardAsync(db, schedule.TargetId, schedule.OwnerUserId, ct);
        if (board is null || DashboardKind.Of(board.ConfigJson) != DashboardKind.Dashboard)
            throw new DeliveryException("The dashboard no longer exists, or the schedule's owner can no longer read it.");
        return new RenderedDelivery(board.DashboardName, DeliveryLinks.For(config["App:PublicBaseUrl"], DeliveryTerms.Dashboard, board.DashboardId), false, []);
    }
}
