namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Represents an external database connection used as a data source.
/// Maps to [core].[DatabaseConnections] created by init-tenant-schema.sql.
/// Password is stored as a PBKDF2-SHA256 hash.
/// </summary>
public class DatabaseConnection
{
    public long Id { get; set; }
    public string ConnectionName { get; set; } = string.Empty;
    public string Server { get; set; } = string.Empty;
    public int Port { get; set; } = 1433;
    public string DatabaseName { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>mssql | postgres | mysql | mariadb | redshift | clickhouse | trino</summary>
    public string Provider { get; set; } = "mssql";

    public bool TrustServerCertificate { get; set; } = true;
    public bool IsActive { get; set; } = true;

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}
