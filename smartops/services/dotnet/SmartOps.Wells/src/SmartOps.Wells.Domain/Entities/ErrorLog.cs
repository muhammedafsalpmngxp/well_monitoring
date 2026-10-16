namespace SmartOps.Wells.Domain.Entities;

/// <summary>Error log entry generated from manual trigger execution of a validation rule.</summary>
public class ErrorLog
{
    public int Id { get; set; }
    public string RuleId { get; set; } = string.Empty;
    public string? Severity { get; set; }
    public string? RuleName { get; set; }
    public string? PrimaryField { get; set; }
    public string? Status { get; set; }
    public string? Well { get; set; }
    public string? Sla { get; set; }
    public DateTime? CreatedAt { get; set; }
}
