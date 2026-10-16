using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.HealthChecks;

/// <summary>
/// Performs a real connectivity and schema validation check against the control-plane database.
/// Verifies: TCP connection, SQL query execution, schema existence, and table accessibility.
/// </summary>
public sealed class ControlPlaneDbHealthCheck(ControlPlaneDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var data = new Dictionary<string, object>();
        var startedAt = DateTimeOffset.UtcNow;

        try
        {
            // 1. Can we connect to SQL Server at all?
            var canConnect = await db.Database.CanConnectAsync(ct);
            if (!canConnect)
            {
                data["database"] = "unreachable";
                return HealthCheckResult.Unhealthy("Cannot connect to SQL Server.", data: data);
            }
            data["database"] = "connected";

            // 2. Check pending migrations
            var pendingMigrations = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
            data["pending_migrations"] = pendingMigrations.Count;
            if (pendingMigrations.Count > 0)
            {
                data["pending_migration_names"] = string.Join(", ", pendingMigrations);
                return HealthCheckResult.Degraded(
                    $"{pendingMigrations.Count} pending migration(s) not applied.",
                    data: data);
            }

            // 3. Verify the control schema exists and core tables are accessible
            var tableCount = await db.Database.SqlQueryRaw<int>(
                "SELECT COUNT(*) AS [Value] FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'control'"
            ).FirstOrDefaultAsync(ct);

            data["control_schema_tables"] = tableCount;
            if (tableCount < 16)
            {
                return HealthCheckResult.Degraded(
                    $"Expected 16 tables in [control] schema, found {tableCount}.",
                    data: data);
            }

            // 4. Quick read test — hit a lightweight table to confirm query execution works
            var regionCount = await db.Regions.CountAsync(ct);
            data["region_count"] = regionCount;

            var elapsed = DateTimeOffset.UtcNow - startedAt;
            data["response_time_ms"] = (int)elapsed.TotalMilliseconds;

            return HealthCheckResult.Healthy("All checks passed.", data: data);
        }
        catch (Exception ex)
        {
            data["error"] = ex.Message;
            var elapsed = DateTimeOffset.UtcNow - startedAt;
            data["response_time_ms"] = (int)elapsed.TotalMilliseconds;

            return HealthCheckResult.Unhealthy("Health check failed.", ex, data);
        }
    }
}
