using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SmartOps.Shared.Auth;
using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Infrastructure.Caching;
using TWise.Backend.ControlPlane.Infrastructure.HealthChecks;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;
using TWise.Backend.ControlPlane.Infrastructure.Repositories;
using TWise.Backend.ControlPlane.Infrastructure.Services;

namespace TWise.Backend.ControlPlane.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registers Infrastructure layer services: EF Core DbContext, generic repository,
    /// domain services, and health checks.
    /// Call from Program.cs: <c>builder.Services.AddInfrastructure(builder.Configuration);</c>
    /// </summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddDbContext<ControlPlaneDbContext>(opt =>
        {
            var cs = configuration.GetConnectionString("ControlPlane")
                ?? throw new InvalidOperationException("ConnectionStrings:ControlPlane is not configured.");
            opt.UseSqlServer(cs, sql =>
            {
                sql.CommandTimeout(120);
                sql.EnableRetryOnFailure();
            });
        });

        // Legacy employee directory (read-only, no migrations)
        services.AddDbContext<LegacyDirectoryDbContext>(opt =>
        {
            var cs = configuration.GetConnectionString("LegacyDirectory")
                ?? throw new InvalidOperationException("ConnectionStrings:LegacyDirectory is not configured.");
            opt.UseSqlServer(cs, sql =>
            {
                sql.CommandTimeout(30);
                sql.EnableRetryOnFailure();
            });
        });

        // Caching
        services.AddMemoryCache();
        services.AddSingleton<ICacheService, MemoryCacheService>();
        services.AddHttpContextAccessor();
        services.AddSingleton<ILoginProtectionService, LoginProtectionService>();

        // Repositories
        services.AddScoped(typeof(IGenericRepository<>), typeof(GenericRepository<>));

        // Services
        services.AddScoped<ITenantService, TenantService>();
        services.AddScoped<ISourceService, SourceService>();
        services.AddScoped<ISourceSystemService, SourceSystemService>();
        services.AddScoped<ITenantSourceService, TenantSourceService>();
        services.AddScoped<ICanonicalEntityService, CanonicalEntityService>();
        services.AddScoped<ICanonicalFieldService, CanonicalFieldService>();
        services.AddScoped<IFieldMappingService, FieldMappingService>();
        services.AddScoped<ICapabilityProfileService, CapabilityProfileService>();
        services.AddScoped<IAccessService, AccessService>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IAccessTokenValidator, AccessTokenValidator>();
        services.AddScoped<IOperationService, OperationService>();
        services.AddScoped<IWidgetLibraryService, WidgetLibraryService>();
        services.AddScoped<ILegacyDirectoryService, LegacyDirectoryService>();

        // Notifications — centralized store (control.Notification/NotificationRecipient). Every
        // notification type (ControlPlane-native like access/role change, or ingested from other
        // services like Tenant's Data Share/Data Quality) writes/reads through this one service.
        services.AddScoped<INotificationService, TWise.Backend.ControlPlane.Infrastructure.Services.NotificationService>();

        // Provisioning
        services.Configure<ProvisioningOptions>(configuration.GetSection(ProvisioningOptions.SectionName));
        services.AddScoped<ITenantProvisioningService, TenantProvisioningService>();
        services.AddHostedService<ProvisioningWorker>();

        // Health checks
        services.AddHealthChecks()
            .AddCheck<ControlPlaneDbHealthCheck>("controlplane-db", tags: ["db", "ready"]);

        return services;
    }
}
