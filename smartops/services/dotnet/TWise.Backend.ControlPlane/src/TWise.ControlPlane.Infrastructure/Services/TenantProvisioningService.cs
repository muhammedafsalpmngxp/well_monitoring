using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed partial class TenantProvisioningService(
    ControlPlaneDbContext db,
    IOptions<ProvisioningOptions> options,
    ILogger<TenantProvisioningService> logger) : ITenantProvisioningService
{
    private readonly ProvisioningOptions _opts = options.Value;

    private const string CreateSchemasScript = """
        IF SCHEMA_ID(N'ref') IS NULL EXEC(N'CREATE SCHEMA ref AUTHORIZATION dbo;');
        IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core AUTHORIZATION dbo;');
        IF SCHEMA_ID(N'ml') IS NULL EXEC(N'CREATE SCHEMA ml AUTHORIZATION dbo;');
        IF SCHEMA_ID(N'meta') IS NULL EXEC(N'CREATE SCHEMA meta AUTHORIZATION dbo;');
        IF SCHEMA_ID(N'raw') IS NULL EXEC(N'CREATE SCHEMA raw AUTHORIZATION dbo;');
        """;

    private const string ProvisionStepLogTemplate = "Provisioning {TenantCode}: completed step {Step}";

    [GeneratedRegex(@"^[a-zA-Z0-9_-]+$")]
    private static partial Regex SafeIdentifierRegex();

    public async Task<Result> ProvisionAsync(long tenantId, CancellationToken ct)
    {
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.TenantId == tenantId, ct);
        if (tenant is null)
            return Result.NotFound($"Tenant {tenantId} not found.");

        if (tenant.Status == "active")
            return Result.Success();

        var dbName = $"{_opts.DatabasePrefix}{tenant.TenantCode}";
        ValidateDatabaseName(dbName);

        try
        {
            // ── Step 1: Mark as provisioning ─────────────────────────────────
            tenant.Status = "provisioning";
            tenant.ProvisionStep = "init";
            await db.SaveChangesAsync(ct);

            // ── Step 2: Create database ──────────────────────────────────────
            tenant.ProvisionStep = "create_db";
            await db.SaveChangesAsync(ct);

            await CreateDatabaseAsync(dbName, ct);
            logger.LogDebug(ProvisionStepLogTemplate, tenant.TenantCode, tenant.ProvisionStep);

            // ── Step 3: Create schemas ───────────────────────────────────────
            tenant.ProvisionStep = "create_schemas";
            await db.SaveChangesAsync(ct);

            await ExecuteOnTenantDbAsync(dbName, CreateSchemasScript, ct);
            logger.LogDebug(ProvisionStepLogTemplate, tenant.TenantCode, tenant.ProvisionStep);

            // ── Step 4: Create tables ────────────────────────────────────────
            tenant.ProvisionStep = "create_tables";
            await db.SaveChangesAsync(ct);

            var schemaScript = await LoadSchemaScriptAsync(ct);
            await ExecuteOnTenantDbAsync(dbName, schemaScript, ct);
            logger.LogDebug(ProvisionStepLogTemplate, tenant.TenantCode, tenant.ProvisionStep);

            // ── Step 5: Create constraints ───────────────────────────────────
            tenant.ProvisionStep = "create_constraints";
            await db.SaveChangesAsync(ct);

            var constraintScript = await LoadConstraintScriptAsync(ct);
            if (!string.IsNullOrWhiteSpace(constraintScript))
            {
                await ExecuteOnTenantDbAsync(dbName, constraintScript, ct);
                logger.LogDebug(ProvisionStepLogTemplate, tenant.TenantCode, tenant.ProvisionStep);
            }

            // ── Step 6: Seed data ────────────────────────────────────────────
            tenant.ProvisionStep = "seeding";
            await db.SaveChangesAsync(ct);

            var seedScript = await LoadSeedScriptAsync(ct);
            if (!string.IsNullOrWhiteSpace(seedScript))
            {
                await ExecuteOnTenantDbAsync(dbName, seedScript, ct);
                logger.LogDebug(ProvisionStepLogTemplate, tenant.TenantCode, tenant.ProvisionStep);
            }

            // ── Step 7: Insert meta.SchemaInfo ───────────────────────────────
            var schemaVersion = await db.SchemaVersions
                .Where(sv => sv.IsCurrent)
                .Select(sv => sv.VersionNo)
                .FirstOrDefaultAsync(ct) ?? "1.0.0";

            await InsertSchemaInfoAsync(dbName, schemaVersion, ct);

            // ── Step 8: Finalize ─────────────────────────────────────────────
            tenant.ProvisionStep = "complete";
            tenant.Status = "active";
            tenant.DataPlaneRef = BuildConnectionString(dbName);
            await db.SaveChangesAsync(ct);

            logger.LogInformation("Tenant {TenantCode} provisioned successfully → [{DbName}]", tenant.TenantCode, dbName);
            return Result.Success();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Provisioning failed for tenant {TenantCode} at step {Step}", tenant.TenantCode, tenant.ProvisionStep);
            tenant.Status = "provision_failed";
            tenant.RetryCount++;
            await db.SaveChangesAsync(CancellationToken.None);
            return Result.Failure($"Provisioning failed at step '{tenant.ProvisionStep}': {ex.Message}");
        }
    }

    public async Task<Result> RetryProvisionAsync(long tenantId, CancellationToken ct)
    {
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.TenantId == tenantId, ct);
        if (tenant is null)
            return Result.NotFound($"Tenant {tenantId} not found.");

        if (tenant.Status != "provision_failed")
            return Result.NotFound("Tenant is not in a failed provisioning state.");

        if (tenant.RetryCount >= _opts.MaxRetries)
            return Result.NotFound($"Max retries ({_opts.MaxRetries}) exceeded. Manual intervention required.");

        return await ProvisionAsync(tenantId, ct);
    }

    public async Task<Result> DecommissionAsync(long tenantId, CancellationToken ct)
    {
        var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.TenantId == tenantId, ct);
        if (tenant is null)
            return Result.NotFound($"Tenant {tenantId} not found.");

        var dbName = $"{_opts.DatabasePrefix}{tenant.TenantCode}";

        try
        {
            tenant.Status = "decommissioning";
            await db.SaveChangesAsync(ct);

            // Drop tenant database
            await DropDatabaseAsync(dbName, ct);

            tenant.Status = "decommissioned";
            tenant.DataPlaneRef = null;
            await db.SaveChangesAsync(ct);

            logger.LogInformation("Tenant {TenantCode} decommissioned — database [{DbName}] dropped", tenant.TenantCode, dbName);
            return Result.Success();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Decommissioning failed for tenant {TenantCode}", tenant.TenantCode);
            return Result.NotFound($"Decommissioning failed: {ex.Message}");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Private helpers
    // ═══════════════════════════════════════════════════════════════════════════

    private string BuildMasterConnectionString() =>
        new SqlConnectionStringBuilder
        {
            DataSource = _opts.TargetServer,
            UserID = _opts.AdminUser,
            Password = _opts.AdminPassword,
            InitialCatalog = "master",
            TrustServerCertificate = _opts.TrustServerCertificate,
            ConnectTimeout = 30
        }.ConnectionString;

    private string BuildConnectionString(string dbName) =>
        new SqlConnectionStringBuilder
        {
            DataSource = _opts.TargetServer,
            UserID = _opts.AdminUser,
            Password = _opts.AdminPassword,
            InitialCatalog = dbName,
            TrustServerCertificate = _opts.TrustServerCertificate,
            ConnectTimeout = 30
        }.ConnectionString;

    [SuppressMessage("Security", "S3649:User inputs should not be used in SQL statements",
        Justification = "DDL identifiers cannot be parameterized; dbName is validated by SafeIdentifierRegex and escaped via QUOTENAME.")]
    private async Task CreateDatabaseAsync(string dbName, CancellationToken ct)
    {
        ValidateDatabaseName(dbName);

        await using var conn = new SqlConnection(BuildMasterConnectionString());
        await conn.OpenAsync(ct);

        // Check if DB already exists (idempotent) — parameterized lookup
        await using var checkCmd = conn.CreateCommand();
        checkCmd.CommandText = "SELECT DB_ID(@dbName)";
        checkCmd.Parameters.AddWithValue("@dbName", dbName);
        var result = await checkCmd.ExecuteScalarAsync(ct);
        if (result is not null && result != DBNull.Value)
            return; // Already exists

        // DDL uses sp_executesql + QUOTENAME for safe identifier injection
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DECLARE @sql NVARCHAR(500) = N'CREATE DATABASE ' + QUOTENAME(@name); EXEC sp_executesql @sql;";
        cmd.Parameters.AddWithValue("@name", dbName);
        cmd.CommandTimeout = 60;
        await cmd.ExecuteNonQueryAsync(ct);

        // Wait for DB to be online
        await Task.Delay(2000, ct);
    }

    [SuppressMessage("Security", "S3649:User inputs should not be used in SQL statements",
        Justification = "DDL identifiers cannot be parameterized; dbName is validated by SafeIdentifierRegex and escaped via QUOTENAME.")]
    private async Task DropDatabaseAsync(string dbName, CancellationToken ct)
    {
        ValidateDatabaseName(dbName);

        await using var conn = new SqlConnection(BuildMasterConnectionString());
        await conn.OpenAsync(ct);

        // DDL uses sp_executesql + QUOTENAME for safe identifier injection
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            IF DB_ID(@name) IS NOT NULL
            BEGIN
                DECLARE @sql NVARCHAR(1000) =
                    N'ALTER DATABASE ' + QUOTENAME(@name) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ' +
                    N'DROP DATABASE ' + QUOTENAME(@name) + N';';
                EXEC sp_executesql @sql;
            END
            """;
        cmd.Parameters.AddWithValue("@name", dbName);
        cmd.CommandTimeout = 60;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task ExecuteOnTenantDbAsync(string dbName, string script, CancellationToken ct)
    {
        await using var conn = new SqlConnection(BuildConnectionString(dbName));
        await conn.OpenAsync(ct);

        // Split on GO batches
        var batches = script
            .Split(["\nGO\n", "\nGO\r\n", "\r\nGO\r\n", "\r\nGO\n"], StringSplitOptions.RemoveEmptyEntries)
            .Where(b => !string.IsNullOrWhiteSpace(b));

        foreach (var batch in batches)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = batch;
            cmd.CommandTimeout = 120;
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    private async Task<string> LoadSchemaScriptAsync(CancellationToken ct)
    {
        var path = Path.Combine(AppContext.BaseDirectory, _opts.SchemaScriptPath);
        if (!File.Exists(path))
            throw new FileNotFoundException($"Tenant schema script not found: {path}");
        return await File.ReadAllTextAsync(path, ct);
    }

    private async Task<string> LoadConstraintScriptAsync(CancellationToken ct)
    {
        var path = Path.Combine(AppContext.BaseDirectory, _opts.SchemaScriptPath.Replace(".sql", "-constraints.sql"));
        if (!File.Exists(path)) return string.Empty;
        return await File.ReadAllTextAsync(path, ct);
    }

    private async Task<string> LoadSeedScriptAsync(CancellationToken ct)
    {
        var path = Path.Combine(AppContext.BaseDirectory, _opts.SchemaScriptPath.Replace(".sql", "-seed.sql"));
        if (!File.Exists(path)) return string.Empty;
        return await File.ReadAllTextAsync(path, ct);
    }

    private async Task InsertSchemaInfoAsync(string dbName, string schemaVersion, CancellationToken ct)
    {
        await using var conn = new SqlConnection(BuildConnectionString(dbName));
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO meta.SchemaInfo (schema_version_no, built_at, migrated_at)
            VALUES (@schemaVersion, SYSUTCDATETIME(), SYSUTCDATETIME());
            """;
        cmd.Parameters.AddWithValue("@schemaVersion", schemaVersion);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static void ValidateDatabaseName(string dbName)
    {
        if (dbName.Length > 128)
            throw new ArgumentException($"Database name '{dbName}' exceeds SQL Server's 128-character limit.", nameof(dbName));

        if (!SafeIdentifierRegex().IsMatch(dbName))
            throw new ArgumentException($"Database name '{dbName}' contains unsafe characters.", nameof(dbName));
    }
}
