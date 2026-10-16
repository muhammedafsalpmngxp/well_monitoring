using SmartOps.Shared.Db;

namespace SmartOps.Integrations.Domain.Entities;

public class IntegrationEndpoint : AuditableEntity
{
    public string Key { get; set; } = string.Empty;          // sap.po, sf.account, snow.incident
    public string System { get; set; } = string.Empty;       // SAP / Salesforce / ServiceNow
    public string Name { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = string.Empty;
    public string AuthType { get; set; } = "oauth";           // oauth / apikey / basic
    public string ConfigJson { get; set; } = "{}";
    public string Status { get; set; } = "active";
}

public class SyncJob : AuditableEntity
{
    public string EndpointKey { get; set; } = string.Empty;
    public string Direction { get; set; } = "outbound";       // inbound / outbound / bidirectional
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }
    public int RecordsSent { get; set; }
    public int RecordsReceived { get; set; }
    public int Errors { get; set; }
    public string Status { get; set; } = "running";
    public string? Note { get; set; }
}
