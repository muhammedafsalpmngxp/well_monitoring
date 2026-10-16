using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SmartOps.Shared.Db;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Infrastructure.Persistence;
using SmartOps.Wells.Infrastructure.Repositories;

namespace SmartOps.Wells.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registers Infrastructure layer services: EF Core DbContext, repository implementations,
    /// audit interceptor, and health checks.
    /// Call from Program.cs: <c>builder.Services.AddInfrastructure(builder.Configuration);</c>
    /// </summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<AuditSaveChangesInterceptor>();

        services.AddDbContext<WellsDbContext>((sp, opt) =>
        {
            var cs = configuration.GetConnectionString("Default")
                ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
            opt.UseSqlServer(cs, sql => sql.CommandTimeout(120));
            opt.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());
        });

        services.AddScoped<IWellsRepository, WellsRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();
        services.AddScoped<ICrewRepository, CrewRepository>();
        services.AddScoped<IPhProductivityRepository, PhProductivityRepository>();
        services.AddMemoryCache();

        // Background service that pre-loads activities data into memory
        // NOTE: Commented out — not used in frontend currently, saves ~5-7 GB RAM
        // services.AddHostedService<ActivitiesCacheLoader>();
        services.AddHostedService<CrewCacheLoader>();
        services.AddHostedService<WmrSnapshotCacheLoader>();
        services.AddHostedService<DashboardCacheWarmup>();

        // Health check for SQL Server connectivity
        services.AddHealthChecks()
            .AddDbContextCheck<WellsDbContext>("wells-db");

        return services;
    }
}
