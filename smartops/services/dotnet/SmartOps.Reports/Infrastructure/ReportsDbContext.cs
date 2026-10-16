using Microsoft.EntityFrameworkCore;
using SmartOps.Reports.Domain.Entities;

namespace SmartOps.Reports.Infrastructure;

public class ReportsDbContext(DbContextOptions<ReportsDbContext> options) : DbContext(options)
{
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<ReportSchedule> Schedules => Set<ReportSchedule>();
    public DbSet<BriefingSnapshot> Briefings => Set<BriefingSnapshot>();
    public DbSet<Alert> Alerts => Set<Alert>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Report>(e => { e.ToTable("reports"); e.HasIndex(x => x.Key).IsUnique(); });
        b.Entity<ReportSchedule>(e => { e.ToTable("report_schedules"); e.HasIndex(x => x.ReportKey); });
        b.Entity<BriefingSnapshot>(e => { e.ToTable("briefings"); e.HasIndex(x => new { x.Audience, x.Period }); });
        b.Entity<Alert>(e =>
        {
            e.ToTable("alerts");
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.Severity);
            e.HasIndex(x => x.WellId);
        });
    }
}
