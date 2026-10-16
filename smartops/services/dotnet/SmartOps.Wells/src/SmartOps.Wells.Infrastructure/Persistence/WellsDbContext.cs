using Microsoft.EntityFrameworkCore;
using SmartOps.Wells.Domain.Entities;

namespace SmartOps.Wells.Infrastructure.Persistence;

public class WellsDbContext(DbContextOptions<WellsDbContext> options) : DbContext(options)
{
    public DbSet<Cluster> Clusters => Set<Cluster>();
    public DbSet<Well> Wells => Set<Well>();
    public DbSet<Milestone> Milestones => Set<Milestone>();
    public DbSet<WatchlistEntry> Watchlist => Set<WatchlistEntry>();
    public DbSet<CriticalDate> CriticalDates => Set<CriticalDate>();
    public DbSet<ActivityTaskPlan> ActivityTaskPlan => Set<ActivityTaskPlan>();
    public DbSet<TaskDaily> TaskDaily => Set<TaskDaily>();
    public DbSet<ErrorLog> ErrorLogs => Set<ErrorLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Cluster>(e =>
        {
            e.ToTable("clusters");
            e.HasIndex(c => c.Key).IsUnique();
            e.Property(c => c.Key).HasMaxLength(64).IsRequired();
            e.Property(c => c.Name).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<Well>(e =>
        {
            e.ToTable("wells");
            e.HasIndex(w => w.WellId).IsUnique();
            e.HasIndex(w => w.Cluster);
            e.HasIndex(w => w.Status);
            e.Property(w => w.WellId).HasMaxLength(64).IsRequired();
            e.Property(w => w.Cluster).HasMaxLength(64).IsRequired();
            e.Property(w => w.Location).HasMaxLength(255);
            e.Property(w => w.Activity).HasMaxLength(255);
            e.Property(w => w.Status).HasMaxLength(64);
            // Computed property — ignore in EF
            e.Ignore(w => w.ProgressVariance);
        });

        modelBuilder.Entity<Milestone>(e =>
        {
            e.ToTable("milestones");
            e.HasIndex(m => m.WellId);
            e.HasIndex(m => m.Status);
            e.Property(m => m.Name).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<WatchlistEntry>(e =>
        {
            e.ToTable("watchlist");
            e.HasIndex(w => new { w.UserId, w.WellId }).IsUnique();
        });

        modelBuilder.Entity<CriticalDate>(e =>
        {
            e.ToTable("critical_dates");
            e.Property(c => c.Label).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<ActivityTaskPlan>(e =>
        {
            e.ToTable("ActivityTaskPlan", "dbo");
            e.HasNoKey();
            e.Property(x => x.CrewType).HasColumnName("crew_type").HasMaxLength(64);
            e.Property(x => x.CrewCode).HasColumnName("crew_uid").HasMaxLength(64);
            e.Property(x => x.WellId).HasColumnName("Well_ID").HasMaxLength(64);
            e.Property(x => x.StartDate).HasColumnName("start_date");
            e.Property(x => x.EndDate).HasColumnName("end_date");
            e.Property(x => x.ProjectId).HasColumnName("project_id").HasMaxLength(64);
            e.Property(x => x.Type).HasColumnName("type").HasMaxLength(16);
            e.Property(x => x.Progress).HasColumnName("progress").HasMaxLength(16);
        });

        modelBuilder.Entity<TaskDaily>(e =>
        {
            e.ToTable("task_daily", "dbo");
            e.HasNoKey();
            e.Property(x => x.CrewType).HasColumnName("crew_type").HasMaxLength(64);
            e.Property(x => x.CrewCode).HasColumnName("crew_code").HasMaxLength(64);
            e.Property(x => x.WellId).HasColumnName("well_id").HasMaxLength(64);
            e.Property(x => x.ActionOn).HasColumnName("ActionOn");
        });

        modelBuilder.Entity<ErrorLog>(e =>
        {
            e.ToTable("ERROR_LOG", "dbo");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("ERROR_ID").ValueGeneratedOnAdd();
            e.Property(x => x.RuleId).HasColumnName("RULE_ID").HasMaxLength(5).IsRequired();
            e.Property(x => x.Severity).HasColumnName("SEVERITY").HasColumnType("varchar(20)");
            e.Property(x => x.RuleName).HasColumnName("RULE_NAME").HasColumnType("varchar(30)");
            e.Property(x => x.PrimaryField).HasColumnName("PRIMARY_FIELD").HasColumnType("varchar(30)");
            e.Property(x => x.Status).HasColumnName("STATUS").HasColumnType("varchar(20)");
            e.Property(x => x.Well).HasColumnName("WELL").HasColumnType("varchar(20)");
            e.Property(x => x.Sla).HasColumnName("SLA").HasColumnType("varchar(20)");
            e.Property(x => x.CreatedAt).HasColumnName("CREATED_AT").HasColumnType("datetime");
        });
    }
}
