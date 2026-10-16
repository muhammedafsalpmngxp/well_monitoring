using Microsoft.EntityFrameworkCore;
using SmartOps.Integrations.Domain.Entities;

namespace SmartOps.Integrations.Infrastructure;

public class IntegrationsDbContext(DbContextOptions<IntegrationsDbContext> options) : DbContext(options)
{
    public DbSet<IntegrationEndpoint> Endpoints => Set<IntegrationEndpoint>();
    public DbSet<SyncJob> SyncJobs => Set<SyncJob>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<IntegrationEndpoint>(e =>
        {
            e.ToTable("endpoints");
            e.HasIndex(x => x.Key).IsUnique();
        });
        b.Entity<SyncJob>(e =>
        {
            e.ToTable("sync_jobs");
            e.HasIndex(x => x.EndpointKey);
            e.HasIndex(x => x.StartedAt);
        });
    }
}
