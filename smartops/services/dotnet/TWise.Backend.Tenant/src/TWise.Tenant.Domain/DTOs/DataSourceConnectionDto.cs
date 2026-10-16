namespace TWise.Tenant.Domain.DTOs;

/// <summary>
/// A pull-based data source connection as returned to the client.
/// Credentials are never included — only whether any are stored.
/// </summary>
public record DataSourceConnectionDto(
    long Id,
    string ConnectionName,
    string Kind,
    string AuthType,
    bool HasCredentials,
    string ConfigJson,
    string? LastStatus,
    string? LastErrorMessage,
    DateTime? LastTestedAt,
    bool IsActive,
    long TenantId,
    long CreatedBy,
    DateTime CreatedAt,
    long? ModifiedBy,
    DateTime ModifiedAt
);

public record CreateDataSourceConnectionRequest(
    string ConnectionName,
    string Kind,
    string AuthType,
    // Kind-specific non-secret settings. Serialised verbatim into ConfigJson.
    Dictionary<string, object?>? Config,
    // Secret values (apiKey, token, username/password...). Encrypted at rest, never read back.
    Dictionary<string, string>? Credentials
);

public record UpdateDataSourceConnectionRequest(
    string ConnectionName,
    string AuthType,
    Dictionary<string, object?>? Config,
    // Omit or leave null to keep the stored credentials unchanged.
    Dictionary<string, string>? Credentials,
    bool IsActive
);

/// <summary>Result of POST /api/data-sources/{id}/test.</summary>
public record DataSourceTestResponse(bool Success, string Message, int? ObjectCount, DateTime TestedAt);

/// <summary>One fetchable object (sheet tab, Drive file, REST endpoint).</summary>
public record DataSourceObjectDto(string Ref, string Name, string ObjectType, long? SizeBytes);

/// <summary>Request body for POST /api/data-sources/{id}/ingest.</summary>
/// <param name="ObjectRef">Object to fetch; null uses the connection's configured default.</param>
/// <param name="DatasetName">Name for the created dataset; defaults to the object's name.</param>
public record IngestDataSourceRequest(string? ObjectRef, string? DatasetName);

/// <summary>Options for the "add data source" UI — kinds, auth types and their required fields.</summary>
public record DataSourceOptionsResponse(
    IReadOnlyList<DataSourceKindOption> Kinds,
    IReadOnlyList<string> AuthTypes,
    IReadOnlyList<string> SqlProviders
);

public record DataSourceKindOption(
    string Kind,
    string Label,
    string Description,
    IReadOnlyList<string> SupportedAuthTypes,
    IReadOnlyList<DataSourceConfigField> ConfigFields
);

/// <param name="Secret">True when the value belongs in Credentials rather than Config.</param>
public record DataSourceConfigField(
    string Name,
    string Label,
    string FieldType,
    bool Required,
    bool Secret = false,
    string? Placeholder = null,
    string? HelpText = null,
    /// <summary>Choices for a "select" field; the first is the default.</summary>
    IReadOnlyList<string>? Options = null
);
