namespace TWise.Tenant.Domain.DTOs;

/// <summary>Represents a database table or view available as a report source.</summary>
public record SourceDto(string Name, string SourceType, string SchemaName, int ColumnCount = 0);
