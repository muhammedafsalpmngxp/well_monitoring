using Microsoft.Extensions.Logging;

namespace SmartOps.Integrations.Connectors;

// Each connector is a stub that demonstrates the pattern. Plug in real
// HttpClients, OAuth flows, and SOAP/REST payload mapping per system.

public sealed class SapConnector(ILogger<SapConnector> log) : IConnector
{
    public string System => "SAP";
    public Task<SyncResult> SyncOutboundAsync(string key, IReadOnlyList<object> records, CancellationToken ct)
    {
        log.LogInformation("SAP outbound stub: {Endpoint} {Count} records", key, records.Count);
        return Task.FromResult(new SyncResult(records.Count, 0, 0, "stub"));
    }
    public Task<SyncResult> SyncInboundAsync(string key, CancellationToken ct)
    {
        log.LogInformation("SAP inbound stub: {Endpoint}", key);
        return Task.FromResult(new SyncResult(0, 0, 0, "stub"));
    }
}

public sealed class SalesforceConnector(ILogger<SalesforceConnector> log) : IConnector
{
    public string System => "Salesforce";
    public Task<SyncResult> SyncOutboundAsync(string key, IReadOnlyList<object> records, CancellationToken ct)
    {
        log.LogInformation("Salesforce outbound stub: {Endpoint} {Count} records", key, records.Count);
        return Task.FromResult(new SyncResult(records.Count, 0, 0, "stub"));
    }
    public Task<SyncResult> SyncInboundAsync(string key, CancellationToken ct)
    {
        log.LogInformation("Salesforce inbound stub: {Endpoint}", key);
        return Task.FromResult(new SyncResult(0, 0, 0, "stub"));
    }
}

public sealed class ServiceNowConnector(ILogger<ServiceNowConnector> log) : IConnector
{
    public string System => "ServiceNow";
    public Task<SyncResult> SyncOutboundAsync(string key, IReadOnlyList<object> records, CancellationToken ct)
    {
        log.LogInformation("ServiceNow outbound stub: {Endpoint} {Count} records", key, records.Count);
        return Task.FromResult(new SyncResult(records.Count, 0, 0, "stub"));
    }
    public Task<SyncResult> SyncInboundAsync(string key, CancellationToken ct)
    {
        log.LogInformation("ServiceNow inbound stub: {Endpoint}", key);
        return Task.FromResult(new SyncResult(0, 0, 0, "stub"));
    }
}
