namespace SmartOps.Integrations.Connectors;

public interface IConnector
{
    string System { get; }
    Task<SyncResult> SyncOutboundAsync(string endpointKey, IReadOnlyList<object> records, CancellationToken ct);
    Task<SyncResult> SyncInboundAsync(string endpointKey, CancellationToken ct);
}

public record SyncResult(int Sent, int Received, int Errors, string? Note);
