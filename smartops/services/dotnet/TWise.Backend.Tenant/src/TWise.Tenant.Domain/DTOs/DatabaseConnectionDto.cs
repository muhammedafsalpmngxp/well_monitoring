namespace TWise.Tenant.Domain.DTOs;

public record DatabaseConnectionDto(
    long Id,
    string ConnectionName,
    string Server,
    int Port,
    string DatabaseName,
    string Username,
    string Provider,
    bool TrustServerCertificate,
    bool IsActive,
    long TenantId,
    long CreatedBy,
    DateTime CreatedAt,
    long? ModifiedBy,
    DateTime ModifiedAt
);

public record CreateDatabaseConnectionRequest(
    string ConnectionName,
    string Server,
    int Port,
    string DatabaseName,
    string Username,
    string Password,
    string Provider = "mssql",
    bool TrustServerCertificate = true
);

public record UpdateDatabaseConnectionRequest(
    string ConnectionName,
    string Server,
    int Port,
    string DatabaseName,
    string Username,
    string? Password,
    string Provider,
    bool TrustServerCertificate,
    bool IsActive
);

// ── Schema Discovery DTOs ───────────────────────────────────────────────────

public record DatabaseSchemaResponse(
    long ConnectionId,
    string ConnectionName,
    string DatabaseName,
    DateTime SyncedAt,
    IReadOnlyList<DatabaseSchemaTableGroup> Tables
);

public record DatabaseSchemaTableGroup(
    string SchemaName,
    string TableName,
    int ColumnCount,
    IReadOnlyList<DatabaseSchemaColumnDto> Columns
);

public record DatabaseSchemaColumnDto(
    long Id,
    string ColumnName,
    string DataType,
    bool IsNullable,
    bool IsPrimaryKey,
    bool IsForeignKey,
    string? ForeignKeySchema,
    string? ForeignKeyTable,
    string? ForeignKeyColumn,
    int? MaxLength,
    int OrdinalPosition
);
