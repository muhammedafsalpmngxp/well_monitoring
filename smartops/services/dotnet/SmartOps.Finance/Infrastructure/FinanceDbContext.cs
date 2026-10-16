using Microsoft.EntityFrameworkCore;
using SmartOps.Finance.Domain.Entities;

namespace SmartOps.Finance.Infrastructure;

public class FinanceDbContext(DbContextOptions<FinanceDbContext> options) : DbContext(options)
{
    public DbSet<JobCost> JobCosts => Set<JobCost>();
    public DbSet<Incentive> Incentives => Set<Incentive>();
    public DbSet<Penalty> Penalties => Set<Penalty>();
    public DbSet<CmrExport> CmrExports => Set<CmrExport>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<JobCost>(e =>
        {
            e.ToTable("job_cost");
            e.HasIndex(j => j.WellId).IsUnique();
            e.Ignore(j => j.Cv); e.Ignore(j => j.Sv);
            e.Ignore(j => j.Cpi); e.Ignore(j => j.Spi);
            e.Property(j => j.BudgetRev).HasPrecision(18, 2);
            e.Property(j => j.EarnedRev).HasPrecision(18, 2);
            e.Property(j => j.BudgetCost).HasPrecision(18, 2);
            e.Property(j => j.ActualCost).HasPrecision(18, 2);
            e.Property(j => j.Penalty).HasPrecision(18, 2);
            e.Property(j => j.Bonus).HasPrecision(18, 2);
        });
        b.Entity<Incentive>(e =>
        {
            e.ToTable("incentives");
            e.HasIndex(i => new { i.CrewCode, i.Period });
            e.Property(i => i.PRating).HasPrecision(8, 4);
            e.Property(i => i.Amount).HasPrecision(18, 2);
        });
        b.Entity<Penalty>(e =>
        {
            e.ToTable("penalties");
            e.HasIndex(p => p.WellId);
            e.Property(p => p.Amount).HasPrecision(18, 2);
        });
        b.Entity<CmrExport>(e =>
        {
            e.ToTable("cmr_exports");
            e.Property(c => c.TotalRevenue).HasPrecision(18, 2);
            e.Property(c => c.TotalPenalty).HasPrecision(18, 2);
            e.Property(c => c.TotalBonus).HasPrecision(18, 2);
        });
    }
}
