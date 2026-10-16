namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A pull-based external data source (Google Sheets/Drive, REST API).
///
/// Kept separate from <see cref="DatabaseConnection"/> on purpose: those sources have no
/// server/port/database/username and cannot answer arbitrary SQL, so they are fetched on
/// demand and materialised into <see cref="ImportedDataset"/> rows instead of being queried live.
///
/// Maps to [core].[DataSourceConnections].
/// </summary>
public class DataSourceConnection
{
    public long Id { get; set; }

    public string ConnectionName { get; set; } = string.Empty;

    /// <summary>Connector key — see <see cref="DataSourceKinds"/>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Auth scheme — see <see cref="DataSourceAuthTypes"/>.</summary>
    public string AuthType { get; set; } = DataSourceAuthTypes.None;

    /// <summary>
    /// AES-256-GCM ciphertext (via ConnectionPasswordHelper) of a JSON credential bag.
    /// Shape depends on AuthType: {"refreshToken":"…"} for OAuth, {"apiKey":"…"} for a key, etc.
    /// Never returned to the client.
    /// </summary>
    public string? CredentialsEncrypted { get; set; }

    /// <summary>
    /// Non-secret, kind-specific configuration as JSON — spreadsheet id, request URL,
    /// method, headers, the row-array selector, pagination settings, and so on.
    /// </summary>
    public string ConfigJson { get; set; } = "{}";

    /// <summary>Result of the most recent connectivity test or ingest, for the UI status column.</summary>
    public string? LastStatus { get; set; }

    public string? LastErrorMessage { get; set; }

    public DateTime? LastTestedAt { get; set; }

    public bool IsActive { get; set; } = true;

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}

/// <summary>Supported connector kinds.</summary>
public static class DataSourceKinds
{
    public const string GoogleSheets = "google_sheets";
    public const string GoogleDrive = "google_drive";
    public const string RestApi = "rest_api";

    public static readonly IReadOnlyList<string> All = [GoogleSheets, GoogleDrive, RestApi];

    public static bool IsSupported(string? kind) =>
        kind is not null && All.Contains(kind, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Supported authentication schemes for a pull-based source.</summary>
public static class DataSourceAuthTypes
{
    public const string None = "none";
    public const string ApiKey = "api_key";
    public const string Bearer = "bearer";
    public const string Basic = "basic";
    public const string OAuth2 = "oauth2";

    public static readonly IReadOnlyList<string> All = [None, ApiKey, Bearer, Basic, OAuth2];

    public static bool IsSupported(string? authType) =>
        authType is not null && All.Contains(authType, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Status values written to <see cref="DataSourceConnection.LastStatus"/>.</summary>
public static class DataSourceStatus
{
    public const string Untested = "untested";
    public const string Ok = "ok";
    public const string Failed = "failed";
}
