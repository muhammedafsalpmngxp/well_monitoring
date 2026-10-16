using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SmartOps.Reports.Hubs;

/// <summary>
/// SignalR hub for live alerts streamed to the command-centre dashboard.
/// Backed by the Redis SignalR backplane so multiple Reports replicas in AKS
/// stay synchronised.
/// </summary>
[Authorize]
public sealed class AlertsHub : Hub
{
    public Task SubscribeWell(string wellId)
        => Groups.AddToGroupAsync(Context.ConnectionId, $"well:{wellId}");

    public Task UnsubscribeWell(string wellId)
        => Groups.RemoveFromGroupAsync(Context.ConnectionId, $"well:{wellId}");
}

public interface IAlertsBroadcaster
{
    Task BroadcastAsync(object alert, string? wellId = null);
}

public sealed class AlertsBroadcaster(IHubContext<AlertsHub> hub) : IAlertsBroadcaster
{
    public Task BroadcastAsync(object alert, string? wellId = null)
    {
        var t1 = hub.Clients.All.SendAsync("alert", alert);
        var t2 = string.IsNullOrEmpty(wellId)
            ? Task.CompletedTask
            : hub.Clients.Group($"well:{wellId}").SendAsync("well-alert", alert);
        return Task.WhenAll(t1, t2);
    }
}
