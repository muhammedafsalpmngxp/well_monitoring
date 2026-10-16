namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Single reference table storing all discovered schema metadata (tables + columns)
/// from a remote database connection. Each row = one column of one table.
/// Maps to [core].[DatabaseSchema] — FK to DatabaseConnections.
/// </summary>
public class DatabaseSchema
{
    public long Id { get; set; }
    public long ConnectionId { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public string ColumnName { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public bool IsNullable { get; set; } = true;
    public bool IsPrimaryKey { get; set; }
    public bool IsForeignKey { get; set; }
    public string? ForeignKeySchema { get; set; }
    public string? ForeignKeyTable { get; set; }
    public string? ForeignKeyColumn { get; set; }
    public int? MaxLength { get; set; }
    public int OrdinalPosition { get; set; }
    public long TenantId { get; set; }
    public DateTime SyncedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }

    public DatabaseConnection? Connection { get; set; }
}
