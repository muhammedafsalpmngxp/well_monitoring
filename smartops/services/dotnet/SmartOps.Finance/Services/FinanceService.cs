using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using SmartOps.Finance.Domain.Dtos;
using SmartOps.Finance.Domain.Entities;
using SmartOps.Finance.Infrastructure;

namespace SmartOps.Finance.Services;

public interface IFinanceService
{
    Task<List<JobCostDto>> ListJobCostsAsync(string? wellId);
    Task<JobCostDto?> GetJobCostAsync(string wellId);
    Task<JobCostDto> UpsertJobCostAsync(JobCostUpsertRequest request);
    Task<EvmSummaryDto> GetEvmSummaryAsync();
    Task<List<IncentiveDto>> ListIncentivesAsync(string? crewCode, string? period, string? status);
    Task<IncentiveDto> CreateIncentiveAsync(IncentiveCreateRequest request);
    Task<IncentiveDto?> ApproveIncentiveAsync(int id, string approver);
    Task<List<PenaltyDto>> ListPenaltiesAsync(string? wellId, string? status);
    Task<PenaltyDto> CreatePenaltyAsync(PenaltyCreateRequest request);
    Task<byte[]> ExportCmrAsync();
}

public sealed class FinanceService(FinanceDbContext db) : IFinanceService
{
    public Task<List<JobCostDto>> ListJobCostsAsync(string? wellId)
    {
        var q = db.JobCosts.AsQueryable();
        if (!string.IsNullOrWhiteSpace(wellId)) q = q.Where(j => j.WellId == wellId);
        return q.OrderBy(j => j.WellId).Select(j => ToDto(j)).ToListAsync();
    }

    public async Task<JobCostDto?> GetJobCostAsync(string wellId)
    {
        var j = await db.JobCosts.FirstOrDefaultAsync(x => x.WellId == wellId);
        return j is null ? null : ToDto(j);
    }

    public async Task<JobCostDto> UpsertJobCostAsync(JobCostUpsertRequest r)
    {
        var j = await db.JobCosts.FirstOrDefaultAsync(x => x.WellId == r.WellId);
        if (j is null)
        {
            j = new JobCost { WellId = r.WellId };
            db.JobCosts.Add(j);
        }
        j.Status = r.Status; j.BudgetRev = r.BudgetRev; j.EarnedRev = r.EarnedRev;
        j.BudgetCost = r.BudgetCost; j.ActualCost = r.ActualCost;
        j.Penalty = r.Penalty; j.Bonus = r.Bonus;
        await db.SaveChangesAsync();
        return ToDto(j);
    }

    public async Task<EvmSummaryDto> GetEvmSummaryAsync()
    {
        var rows = await db.JobCosts.ToListAsync();
        var earned = rows.Sum(r => r.EarnedRev);
        var actual = rows.Sum(r => r.ActualCost);
        var budget = rows.Sum(r => r.BudgetRev);
        return new EvmSummaryDto(
            TotalBudgetRev: budget,
            TotalEarnedRev: earned,
            TotalActualCost: actual,
            TotalPenalty: rows.Sum(r => r.Penalty),
            TotalBonus: rows.Sum(r => r.Bonus),
            Cpi: actual == 0 ? 0 : Math.Round(earned / actual, 4),
            Spi: budget == 0 ? 0 : Math.Round(earned / budget, 4),
            WellsAhead: rows.Count(r => r.Status == "AHEAD"),
            WellsAtRisk: rows.Count(r => r.Status == "AT RISK"),
            WellsCritical: rows.Count(r => r.Status == "CRITICAL"));
    }

    public Task<List<IncentiveDto>> ListIncentivesAsync(string? crewCode, string? period, string? status)
    {
        var q = db.Incentives.AsQueryable();
        if (!string.IsNullOrWhiteSpace(crewCode)) q = q.Where(i => i.CrewCode == crewCode);
        if (!string.IsNullOrWhiteSpace(period)) q = q.Where(i => i.Period == period);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(i => i.Status == status);
        return q.Select(i => new IncentiveDto(i.Id, i.CrewCode, i.Period, i.PRating, i.Amount, i.Status)).ToListAsync();
    }

    public async Task<IncentiveDto> CreateIncentiveAsync(IncentiveCreateRequest r)
    {
        var i = new Incentive { CrewCode = r.CrewCode, Period = r.Period, PRating = r.PRating, Amount = r.Amount };
        db.Incentives.Add(i);
        await db.SaveChangesAsync();
        return new IncentiveDto(i.Id, i.CrewCode, i.Period, i.PRating, i.Amount, i.Status);
    }

    public async Task<IncentiveDto?> ApproveIncentiveAsync(int id, string approver)
    {
        var i = await db.Incentives.FindAsync(id);
        if (i is null) return null;
        i.Status = "approved"; i.ApprovedBy = approver; i.ApprovedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return new IncentiveDto(i.Id, i.CrewCode, i.Period, i.PRating, i.Amount, i.Status);
    }

    public Task<List<PenaltyDto>> ListPenaltiesAsync(string? wellId, string? status)
    {
        var q = db.Penalties.AsQueryable();
        if (!string.IsNullOrWhiteSpace(wellId)) q = q.Where(p => p.WellId == wellId);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(p => p.Status == status);
        return q.OrderByDescending(p => p.IncurredOn)
                .Select(p => new PenaltyDto(p.Id, p.WellId, p.Reason, p.Amount, p.IncurredOn, p.Status))
                .ToListAsync();
    }

    public async Task<PenaltyDto> CreatePenaltyAsync(PenaltyCreateRequest r)
    {
        var p = new Penalty { WellId = r.WellId, Reason = r.Reason, Amount = r.Amount, IncurredOn = r.IncurredOn, Status = r.Status };
        db.Penalties.Add(p);
        await db.SaveChangesAsync();
        return new PenaltyDto(p.Id, p.WellId, p.Reason, p.Amount, p.IncurredOn, p.Status);
    }

    public async Task<byte[]> ExportCmrAsync()
    {
        var rows = await db.JobCosts.OrderBy(j => j.WellId).ToListAsync();
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("CMR");
        ws.Cell(1, 1).Value = "Well";
        ws.Cell(1, 2).Value = "Status";
        ws.Cell(1, 3).Value = "Budget Revenue";
        ws.Cell(1, 4).Value = "Earned Revenue";
        ws.Cell(1, 5).Value = "Actual Cost";
        ws.Cell(1, 6).Value = "Penalty";
        ws.Cell(1, 7).Value = "Bonus";
        ws.Cell(1, 8).Value = "CPI";
        ws.Cell(1, 9).Value = "SPI";

        var r = 2;
        foreach (var j in rows)
        {
            ws.Cell(r, 1).Value = j.WellId;
            ws.Cell(r, 2).Value = j.Status;
            ws.Cell(r, 3).Value = j.BudgetRev;
            ws.Cell(r, 4).Value = j.EarnedRev;
            ws.Cell(r, 5).Value = j.ActualCost;
            ws.Cell(r, 6).Value = j.Penalty;
            ws.Cell(r, 7).Value = j.Bonus;
            ws.Cell(r, 8).Value = (double)(j.ActualCost == 0 ? 0 : j.EarnedRev / j.ActualCost);
            ws.Cell(r, 9).Value = (double)(j.BudgetRev == 0 ? 0 : j.EarnedRev / j.BudgetRev);
            r++;
        }
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static JobCostDto ToDto(JobCost j) =>
        new(j.Id, j.WellId, j.Status, j.BudgetRev, j.EarnedRev, j.BudgetCost, j.ActualCost,
            j.Penalty, j.Bonus, j.Cv, j.Sv, j.Cpi, j.Spi);
}
