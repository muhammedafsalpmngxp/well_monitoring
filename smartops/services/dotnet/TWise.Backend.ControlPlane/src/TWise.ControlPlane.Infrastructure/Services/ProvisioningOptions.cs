namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class ProvisioningOptions
{
    public const string SectionName = "Provisioning";

    /// <summary>Target SQL Server for tenant databases (uses same server as ControlPlane by default).</summary>
    public string TargetServer { get; set; } = string.Empty;

    /// <summary>SQL authentication user for DDL operations (needs CREATE DATABASE permission).</summary>
    public string AdminUser { get; set; } = string.Empty;

    /// <summary>SQL authentication password for DDL operations.</summary>
    public string AdminPassword { get; set; } = string.Empty;

    /// <summary>Database name prefix for tenant databases.</summary>
    public string DatabasePrefix { get; set; } = "smartops_tenant_";

    /// <summary>Maximum auto-retry attempts before marking provision as permanently failed.</summary>
    public int MaxRetries { get; set; } = 5;

    /// <summary>Path to the tenant schema SQL script (relative to app root).</summary>
    public string SchemaScriptPath { get; set; } = "sql/init-tenant-schema.sql";

    /// <summary>Whether to trust the server certificate (dev only).</summary>
    public bool TrustServerCertificate { get; set; } = true;
}
