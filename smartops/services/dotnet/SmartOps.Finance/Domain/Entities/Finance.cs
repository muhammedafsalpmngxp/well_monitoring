using SmartOps.Shared.Db;

namespace SmartOps.Finance.Domain.Entities;

public class JobCost : AuditableEntity
{
    public string WellId { get; set; } = string.Empty;
    public string Status { get; set; } = "ON TRACK";
    public decimal BudgetRev { get; set; }
    public decimal EarnedRev { get; set; }
    public decimal BudgetCost { get; set; }
    public decimal ActualCost { get; set; }
    public decimal Penalty { get; set; }
    public decimal Bonus { get; set; }

    // EVM derived properties
    public decimal Cv => EarnedRev - ActualCost;
    public decimal Sv => EarnedRev - BudgetRev;
    public decimal Cpi => ActualCost == 0 ? 0 : EarnedRev / ActualCost;
    public decimal Spi => BudgetRev == 0 ? 0 : EarnedRev / BudgetRev;
}

public class Incentive : AuditableEntity
{
    public string CrewCode { get; set; } = string.Empty;
    public string Period { get; set; } = string.Empty;     // YYYY-MM
    public decimal PRating { get; set; }
    public decimal Amount { get; set; }
    public string Status { get; set; } = "pending";        // pending/approved/paid
    public string? ApprovedBy { get; set; }
    public DateTime? ApprovedAt { get; set; }
}

public class Penalty : AuditableEntity
{
    public string WellId { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public DateOnly IncurredOn { get; set; }
    public string Status { get; set; } = "open";           // open / contested / paid / waived
}

public class CmrExport : AuditableEntity
{
    public string Period { get; set; } = string.Empty;
    public string GeneratedBy { get; set; } = string.Empty;
    public string BlobUrl { get; set; } = string.Empty;
    public decimal TotalRevenue { get; set; }
    public decimal TotalPenalty { get; set; }
    public decimal TotalBonus { get; set; }
}
