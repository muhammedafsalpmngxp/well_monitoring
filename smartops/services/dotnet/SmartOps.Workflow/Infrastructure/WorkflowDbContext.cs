using Microsoft.EntityFrameworkCore;
using SmartOps.Workflow.Domain.Entities;

namespace SmartOps.Workflow.Infrastructure;

public class WorkflowDbContext(DbContextOptions<WorkflowDbContext> options) : DbContext(options)
{
    public DbSet<FlowDefinition> Flows => Set<FlowDefinition>();
    public DbSet<Connection> Connections => Set<Connection>();
    public DbSet<AiAgent> Agents => Set<AiAgent>();
    public DbSet<AgentRun> AgentRuns => Set<AgentRun>();
    public DbSet<FormDefinition> Forms => Set<FormDefinition>();
    public DbSet<CatalogueItem> Catalogue => Set<CatalogueItem>();
    public DbSet<ServiceRequest> Requests => Set<ServiceRequest>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<FlowDefinition>(e => { e.ToTable("flows"); e.HasIndex(x => x.Key).IsUnique(); });
        b.Entity<Connection>(e => { e.ToTable("connections"); });
        b.Entity<AiAgent>(e => { e.ToTable("ai_agents"); });
        b.Entity<AgentRun>(e => { e.ToTable("agent_runs"); e.HasIndex(x => x.AgentId); });
        b.Entity<FormDefinition>(e => { e.ToTable("forms"); e.HasIndex(x => x.Key).IsUnique(); });
        b.Entity<CatalogueItem>(e => { e.ToTable("catalogue"); e.HasIndex(x => x.Key).IsUnique(); });
        b.Entity<ServiceRequest>(e => { e.ToTable("service_requests"); e.HasIndex(x => x.UserId); });
    }
}
