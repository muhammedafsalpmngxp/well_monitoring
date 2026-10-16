using SmartOps.Shared.Db;

namespace SmartOps.Reports.Domain.Entities;

public class Report : AuditableEntity
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string LayoutJson { get; set; } = "{}";
}

public class ReportSchedule : AuditableEntity
{
    public string ReportKey { get; set; } = string.Empty;
    public string Cron { get; set; } = string.Empty;       // e.g. "0 6 * * *"
    public string RecipientsJson { get; set; } = "[]";
    public string Format { get; set; } = "pdf";            // pdf / xlsx
    public DateTime? LastRun { get; set; }
    public DateTime? NextRun { get; set; }
    public string Status { get; set; } = "active";
}

public class BriefingSnapshot : AuditableEntity
{
    public string Audience { get; set; } = string.Empty;   // md / exec / pm
    public string Period { get; set; } = string.Empty;     // YYYY-MM-DD
    public string Headline { get; set; } = string.Empty;
    public string BodyJson { get; set; } = "{}";
}

public class Alert : AuditableEntity
{
    public string Category { get; set; } = string.Empty;   // delay / material / dq / safety
    public string Severity { get; set; } = "info";          // critical / warning / info
    public string Title { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public string? WellId { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public bool Acknowledged { get; set; }
    public string? AcknowledgedBy { get; set; }
    public DateTime? AcknowledgedAt { get; set; }
}
