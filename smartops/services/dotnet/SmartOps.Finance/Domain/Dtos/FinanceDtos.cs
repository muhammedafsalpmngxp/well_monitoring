using System.ComponentModel.DataAnnotations;

namespace SmartOps.Finance.Domain.Dtos;

public record JobCostDto(int Id, string WellId, string Status,
                         decimal BudgetRev, decimal EarnedRev,
                         decimal BudgetCost, decimal ActualCost,
                         decimal Penalty, decimal Bonus,
                         decimal Cv, decimal Sv, decimal Cpi, decimal Spi);

public record JobCostUpsertRequest(
    [Required] string WellId,
    [Required] string Status,
    decimal BudgetRev, decimal EarnedRev,
    decimal BudgetCost, decimal ActualCost,
    decimal Penalty, decimal Bonus);

public record EvmSummaryDto(decimal TotalBudgetRev, decimal TotalEarnedRev,
                            decimal TotalActualCost, decimal TotalPenalty,
                            decimal TotalBonus, decimal Cpi, decimal Spi,
                            int WellsAhead, int WellsAtRisk, int WellsCritical);

public record IncentiveDto(int Id, string CrewCode, string Period, decimal PRating,
                           decimal Amount, string Status);

public record IncentiveCreateRequest(
    [Required] string CrewCode,
    [Required] string Period,
    decimal PRating, decimal Amount);

public record PenaltyDto(int Id, string WellId, string Reason, decimal Amount,
                         DateOnly IncurredOn, string Status);

public record PenaltyCreateRequest(
    [Required] string WellId,
    [Required] string Reason,
    decimal Amount,
    DateOnly IncurredOn,
    string Status = "open");
