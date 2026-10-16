using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// CRUD, connectivity testing and ingestion for pull-based data sources
/// (Google Sheets, Google Drive, REST API).
/// </summary>
public interface IDataSourceConnectionService
{
    Task<IReadOnlyList<DataSourceConnectionDto>> GetAllAsync(long tenantId, CancellationToken ct = default);

    Task<DataSourceConnectionDto?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default);

    Task<DataSourceConnectionDto> CreateAsync(
        CreateDataSourceConnectionRequest request, long userId, long tenantId, CancellationToken ct = default);

    Task<DataSourceConnectionDto?> UpdateAsync(
        long id, UpdateDataSourceConnectionRequest request, long userId, long tenantId, CancellationToken ct = default);

    Task<bool> DeleteAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>Verify credentials and reachability; records the outcome on the connection.</summary>
    Task<DataSourceTestResponse?> TestAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>List the objects available behind a connection (sheet tabs, Drive files, endpoint).</summary>
    Task<IReadOnlyList<DataSourceObjectDto>?> ListObjectsAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>
    /// Fetch an object and materialise it as an ImportedDataset usable as a chart/tile source.
    /// </summary>
    Task<ImportedDatasetDto?> IngestAsync(
        long id, IngestDataSourceRequest request, long userId, long tenantId, CancellationToken ct = default);

    /// <summary>Kinds, auth types and per-kind config fields for the "add data source" UI.</summary>
    DataSourceOptionsResponse GetOptions();

    /// <summary>Store the refresh token returned by the Google OAuth callback against a connection.</summary>
    Task<bool> SaveGoogleRefreshTokenAsync(
        long id, string refreshToken, long userId, long tenantId, CancellationToken ct = default);
}
