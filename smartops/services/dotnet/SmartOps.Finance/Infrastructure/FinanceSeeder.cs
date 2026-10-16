using SmartOps.Finance.Domain.Entities;

namespace SmartOps.Finance.Infrastructure;

/// <summary>
/// Seed from src/assets/app-globals.js:
///   - JC_WELL_PL (~line 8109) — 6 well P&Ls
///   - Penalty rows derived from CC_WELL_DATA status='Critical'/'At Risk'
/// </summary>
public static class FinanceSeeder
{
    public static async Task SeedAsync(FinanceDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (!db.JobCosts.Any())
        {
            db.JobCosts.AddRange(
                new() { WellId = "34565", Status = "AHEAD",    BudgetRev = 108000, EarnedRev = 118200, BudgetCost = 86400, ActualCost = 94050, Penalty = 0,     Bonus = 14000 },
                new() { WellId = "31780", Status = "CRITICAL", BudgetRev = 148000, EarnedRev = 88400,  BudgetCost = 118400, ActualCost = 71820, Penalty = 52000, Bonus = 0 },
                new() { WellId = "37797", Status = "CRITICAL", BudgetRev = 92000,  EarnedRev = 52600,  BudgetCost = 73600, ActualCost = 42480, Penalty = 48000, Bonus = 0 },
                new() { WellId = "36106", Status = "ON TRACK", BudgetRev = 68000,  EarnedRev = 64800,  BudgetCost = 54400, ActualCost = 52080, Penalty = 0,     Bonus = 10000 },
                new() { WellId = "34561", Status = "AT RISK",  BudgetRev = 82000,  EarnedRev = 68400,  BudgetCost = 65600, ActualCost = 55620, Penalty = 19000, Bonus = 0 },
                new() { WellId = "24665", Status = "ON TRACK", BudgetRev = 62000,  EarnedRev = 68200,  BudgetCost = 49600, ActualCost = 54190, Penalty = 0,     Bonus = 5000 }
            );
        }

        if (!db.Incentives.Any())
        {
            db.Incentives.AddRange(
                new() { CrewCode = "FEC-0602", Period = "2026-04", PRating = 1.05m, Amount = 1200, Status = "approved" },
                new() { CrewCode = "FCR-0303", Period = "2026-04", PRating = 0.92m, Amount = 600,  Status = "pending" },
                new() { CrewCode = "FII-0502", Period = "2026-04", PRating = 0.88m, Amount = 400,  Status = "pending" }
            );
        }

        if (!db.Penalties.Any())
        {
            db.Penalties.AddRange(
                new() { WellId = "31780", Reason = "Schedule slip > 30 days",       Amount = 52000, IncurredOn = DateOnly.Parse("2026-04-20"), Status = "open" },
                new() { WellId = "37797", Reason = "Construction overrun",          Amount = 48000, IncurredOn = DateOnly.Parse("2026-04-15"), Status = "open" },
                new() { WellId = "34561", Reason = "Missed Construction Start",     Amount = 19000, IncurredOn = DateOnly.Parse("2026-04-10"), Status = "contested" }
            );
        }

        await db.SaveChangesAsync();
    }
}
