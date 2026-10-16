namespace TWise.Tenant.Domain.Entities;

public class ErrorLog
{
    public long ErrorId { get; set; }
    public string RuleId { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public int? RecordsFound { get; set; }
    public int? RecordsTotal { get; set; }

    public DataRule? Rule { get; set; }
}