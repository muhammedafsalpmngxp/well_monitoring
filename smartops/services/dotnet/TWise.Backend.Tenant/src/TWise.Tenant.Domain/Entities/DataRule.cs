namespace TWise.Tenant.Domain.Entities;

public class DataRule
{
    public string RuleId { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string RuleName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public string? Fields { get; set; }
    public string? SourceType { get; set; }
    public long? ViewId { get; set; }
    public decimal? ReliabilityScore { get; set; }
    public DateTime? TriggeredOn { get; set; }

    public ICollection<ErrorLog> ErrorLogs { get; set; } = [];
}