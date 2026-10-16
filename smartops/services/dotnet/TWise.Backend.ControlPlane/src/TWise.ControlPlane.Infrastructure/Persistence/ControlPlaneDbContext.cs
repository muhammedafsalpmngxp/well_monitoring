using Microsoft.EntityFrameworkCore;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence;

/// <summary>
/// Maps the control-plane POCOs onto the EXISTING [control].* tables created by
/// infra/sql/init-control-plane.sql. This context never issues DDL (no EnsureCreated /
/// Migrate) — the SQL script remains the single source of truth for the schema.
/// </summary>
public class ControlPlaneDbContext(DbContextOptions<ControlPlaneDbContext> options) : DbContext(options)
{
    public DbSet<Region> Regions => Set<Region>();
    public DbSet<SchemaVersion> SchemaVersions => Set<SchemaVersion>();
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<SourceSystem> SourceSystems => Set<SourceSystem>();
    public DbSet<TenantSource> TenantSources => Set<TenantSource>();
    public DbSet<CanonicalEntity> CanonicalEntities => Set<CanonicalEntity>();
    public DbSet<CanonicalField> CanonicalFields => Set<CanonicalField>();
    public DbSet<FieldMapping> FieldMappings => Set<FieldMapping>();
    public DbSet<CapabilityProfile> CapabilityProfiles => Set<CapabilityProfile>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<UserTenantRole> UserTenantRoles => Set<UserTenantRole>();
    public DbSet<Feature> Features => Set<Feature>();
    public DbSet<TenantFeature> TenantFeatures => Set<TenantFeature>();
    public DbSet<IngestionRun> IngestionRuns => Set<IngestionRun>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<WidgetLibrary> WidgetLibraries => Set<WidgetLibrary>();
    public DbSet<FeatureModule> Modules => Set<FeatureModule>();
    public DbSet<RoleModulePermissions> RoleModulePermissions => Set<RoleModulePermissions>();
    public DbSet<UserPlantAccess> UserPlantAccesses => Set<UserPlantAccess>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationRecipient> NotificationRecipients => Set<NotificationRecipient>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Auto-discovers all IEntityTypeConfiguration<T> classes in this assembly
        // (Persistence/Configurations/ folder) and applies their fluent mappings.
        // Each entity has its own configuration file — add new ones there, not here.
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ControlPlaneDbContext).Assembly);

        // Global query filter: exclude soft-deleted entities by default.
        // Use .IgnoreQueryFilters() on queries that need to include deleted records.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
            .Where(et => typeof(ISoftDeletable).IsAssignableFrom(et.ClrType)))
        {
            var parameter = System.Linq.Expressions.Expression.Parameter(entityType.ClrType, "e");
            var property = System.Linq.Expressions.Expression.Property(parameter, nameof(ISoftDeletable.IsDeleted));
            var notDeleted = System.Linq.Expressions.Expression.Not(property);
            var filter = System.Linq.Expressions.Expression.Lambda(notDeleted, parameter);
            entityType.SetQueryFilter(filter);
        }
    }
}
