using System.Text.Json;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Owns pull-based data sources end to end: CRUD, connectivity tests, object listing and
/// ingestion into ImportedDatasets.
///
/// Ingestion deliberately lands in the same tables as file upload so that connector-backed
/// data is a SourceType='Import' widget source and needs no chart or renderer changes.
/// </summary>
public sealed class DataSourceConnectionService(
    IDataSourceConnectionRepository repo,
    IImportedDatasetRepository datasetRepo,
    IDataSourceConnectorFactory connectorFactory,
    ISqlProviderFactory sqlProviderFactory,
    ILogger<DataSourceConnectionService> logger) : IDataSourceConnectionService
{
    /// <summary>Matches ImportedDatasetService.MaxRows and CK_ImportedDatasets_RowCount in the database.</summary>
    private const int MaxRows = 10_000;

    public async Task<IReadOnlyList<DataSourceConnectionDto>> GetAllAsync(long tenantId, CancellationToken ct = default)
    {
        var entities = await repo.GetAllAsync(tenantId, ct);
        return entities.Select(ToDto).ToList();
    }

    public async Task<DataSourceConnectionDto?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, ct);
        return entity is null ? null : ToDto(entity);
    }

    public async Task<DataSourceConnectionDto> CreateAsync(
        CreateDataSourceConnectionRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        if (!DataSourceKinds.IsSupported(request.Kind))
            throw new NotSupportedException(
                $"Data source kind '{request.Kind}' is not supported. Supported kinds: {string.Join(", ", DataSourceKinds.All)}.");

        if (!DataSourceAuthTypes.IsSupported(request.AuthType))
            throw new NotSupportedException(
                $"Auth type '{request.AuthType}' is not supported. Supported types: {string.Join(", ", DataSourceAuthTypes.All)}.");

        if (await repo.ExistsByNameAsync(request.ConnectionName, tenantId, ct: ct))
            throw new InvalidOperationException($"A data source named '{request.ConnectionName}' already exists.");

        var entity = new DataSourceConnection
        {
            ConnectionName = request.ConnectionName,
            Kind = request.Kind.ToLowerInvariant(),
            AuthType = request.AuthType.ToLowerInvariant(),
            ConfigJson = SerialiseConfig(request.Config),
            CredentialsEncrypted = EncryptCredentials(request.Credentials),
            LastStatus = DataSourceStatus.Untested,
            IsActive = true,
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };

        var saved = await repo.AddAsync(entity, ct);

        logger.LogInformation(
            "Data source '{Name}' ({Kind}) created for tenant {TenantId}",
            saved.ConnectionName, saved.Kind, tenantId);

        return ToDto(saved);
    }

    public async Task<DataSourceConnectionDto?> UpdateAsync(
        long id, UpdateDataSourceConnectionRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, ct);
        if (entity is null) return null;

        if (!DataSourceAuthTypes.IsSupported(request.AuthType))
            throw new NotSupportedException($"Auth type '{request.AuthType}' is not supported.");

        if (await repo.ExistsByNameAsync(request.ConnectionName, tenantId, id, ct))
            throw new InvalidOperationException($"A data source named '{request.ConnectionName}' already exists.");

        entity.ConnectionName = request.ConnectionName;
        entity.AuthType = request.AuthType.ToLowerInvariant();
        entity.IsActive = request.IsActive;
        entity.ModifiedBy = userId;
        entity.ModifiedAt = DateTime.UtcNow;

        if (request.Config is not null)
            entity.ConfigJson = SerialiseConfig(request.Config);

        // Null credentials means "leave what is stored alone" — the client never receives them
        // back, so echoing an empty map on every save would silently wipe them.
        if (request.Credentials is { Count: > 0 })
            entity.CredentialsEncrypted = EncryptCredentials(request.Credentials);

        await repo.UpdateAsync(entity, ct);
        return ToDto(entity);
    }

    public Task<bool> DeleteAsync(long id, long tenantId, CancellationToken ct = default)
        => repo.SoftDeleteAsync(id, tenantId, ct);

    public async Task<DataSourceTestResponse?> TestAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, ct);
        if (entity is null) return null;

        var connector = connectorFactory.Get(entity);

        ConnectionTestResult result;
        try
        {
            result = await connector.TestAsync(entity, ct);
        }
        catch (Exception ex)
        {
            // A connector should return a failed result rather than throw, but a bad config can
            // still surface here. Record it instead of returning a 500 for a user-fixable problem.
            logger.LogWarning(ex, "Data source {ConnectionId} test threw", id);
            result = ConnectionTestResult.Fail(ex.Message);
        }

        var testedAt = DateTime.UtcNow;
        entity.LastStatus = result.Success ? DataSourceStatus.Ok : DataSourceStatus.Failed;
        entity.LastErrorMessage = result.Success ? null : Truncate(result.Message, 500);
        entity.LastTestedAt = testedAt;
        entity.ModifiedAt = testedAt;
        await repo.UpdateAsync(entity, ct);

        return new DataSourceTestResponse(result.Success, result.Message, result.ObjectCount, testedAt);
    }

    public async Task<IReadOnlyList<DataSourceObjectDto>?> ListObjectsAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, ct);
        if (entity is null) return null;

        var objects = await connectorFactory.Get(entity).ListObjectsAsync(entity, ct);
        return objects.Select(o => new DataSourceObjectDto(o.Ref, o.Name, o.ObjectType, o.SizeBytes)).ToList();
    }

    public async Task<ImportedDatasetDto?> IngestAsync(
        long id, IngestDataSourceRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, ct);
        if (entity is null) return null;

        if (!entity.IsActive)
            throw new InvalidOperationException($"Data source '{entity.ConnectionName}' is disabled.");

        var connector = connectorFactory.Get(entity);
        var parsed = await connector.FetchAsync(entity, request.ObjectRef, ct);

        if (parsed.Rows.Count > MaxRows)
            throw new InvalidOperationException(
                $"The source returned {parsed.Rows.Count} rows, which exceeds the {MaxRows}-row limit. " +
                "Narrow the query or filter the source, then ingest again.");

        var datasetName = FirstNonBlank(
            request.DatasetName,
            request.ObjectRef,
            entity.ConnectionName);

        var dataset = new ImportedDataset
        {
            DatasetName = Truncate(datasetName, 200),
            // FileName/FileType carry the provenance for a connector-sourced dataset so the
            // datasets grid can show where the rows came from.
            FileName = Truncate($"{entity.ConnectionName}/{request.ObjectRef ?? "default"}", 255),
            FileType = entity.Kind,
            // Recorded so the dataset can later be refreshed from the same source/object.
            DataSourceConnectionId = entity.Id,
            SourceObjectRef = request.ObjectRef,
            ColumnsJson = JsonSerializer.Serialize(parsed.Columns),
            RowCount = parsed.Rows.Count,
            Status = "completed",
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };

        var rowJson = parsed.Rows.Select(r => JsonSerializer.Serialize(r)).ToList();
        var saved = await datasetRepo.CreateWithRowsAsync(dataset, rowJson, ct);

        var ingestedAt = DateTime.UtcNow;
        entity.LastStatus = DataSourceStatus.Ok;
        entity.LastErrorMessage = null;
        entity.LastTestedAt = ingestedAt;
        entity.ModifiedAt = ingestedAt;
        await repo.UpdateAsync(entity, ct);

        logger.LogInformation(
            "Ingested {RowCount} row(s) from data source {ConnectionId} ({Kind}) into dataset {DatasetId} for tenant {TenantId}",
            parsed.Rows.Count, entity.Id, entity.Kind, saved.Id, tenantId);

        return new ImportedDatasetDto(
            saved.Id, saved.DatasetName, saved.FileName, saved.FileType,
            parsed.Columns, saved.RowCount, saved.Status, saved.ErrorMessage,
            saved.TenantId, saved.CreatedBy, saved.CreatedAt, saved.ModifiedBy, saved.ModifiedAt);
    }

    public async Task<bool> SaveGoogleRefreshTokenAsync(
        long id, string refreshToken, long userId, long tenantId, CancellationToken ct = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, ct);
        if (entity is null) return false;

        entity.CredentialsEncrypted = EncryptCredentials(new Dictionary<string, string> { ["refreshToken"] = refreshToken });
        entity.AuthType = DataSourceAuthTypes.OAuth2;
        entity.LastStatus = DataSourceStatus.Untested;
        entity.LastErrorMessage = null;
        entity.ModifiedBy = userId;
        entity.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateAsync(entity, ct);

        logger.LogInformation("Stored Google refresh token for data source {ConnectionId}, tenant {TenantId}", id, tenantId);
        return true;
    }

    public DataSourceOptionsResponse GetOptions() => new(
        Kinds:
        [
            new DataSourceKindOption(
                DataSourceKinds.GoogleSheets, "Google Sheets",
                "Read a spreadsheet tab from Google Sheets.",
                [DataSourceAuthTypes.OAuth2],
                [
                    new DataSourceConfigField("spreadsheetId", "Spreadsheet ID", "text", true,
                        Placeholder: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
                        HelpText: "The long ID in the sheet URL, between /d/ and /edit."),
                    new DataSourceConfigField("defaultSheet", "Default tab", "text", false,
                        Placeholder: "Sheet1",
                        HelpText: "Leave blank to use the first tab.")
                ]),

            new DataSourceKindOption(
                DataSourceKinds.GoogleDrive, "Google Drive",
                "Import a CSV, JSON or Excel file stored in Google Drive.",
                [DataSourceAuthTypes.OAuth2],
                [
                    new DataSourceConfigField("folderId", "Folder ID", "text", false,
                        HelpText: "Restrict the file list to one folder. Leave blank to list all accessible files.")
                ]),

            new DataSourceKindOption(
                DataSourceKinds.RestApi, "REST API",
                "Fetch JSON rows from an HTTP endpoint.",
                [DataSourceAuthTypes.None, DataSourceAuthTypes.ApiKey, DataSourceAuthTypes.Bearer, DataSourceAuthTypes.Basic],
                [
                    new DataSourceConfigField("url", "Request URL", "text", true,
                        Placeholder: "https://api.example.com/v1/wells"),
                    new DataSourceConfigField("method", "HTTP method", "select", false, Placeholder: "GET",
                        Options: ["GET", "POST", "PUT", "PATCH"]),
                    new DataSourceConfigField("rootPath", "Row path", "text", false,
                        Placeholder: "data.items",
                        HelpText: "Dotted path to the array of rows. Leave blank if the response is already an array."),
                    new DataSourceConfigField("headers", "Headers", "keyvalue", false),
                    new DataSourceConfigField("queryParams", "Query parameters", "keyvalue", false),
                    new DataSourceConfigField("body", "Request body", "textarea", false,
                        Placeholder: "{\"filter\": {\"status\": \"active\"}}",
                        HelpText: "JSON sent with POST, PUT and PATCH requests."),
                    new DataSourceConfigField("pageParam", "Page parameter", "text", false,
                        Placeholder: "page",
                        HelpText: "Set this to page through results."),
                    new DataSourceConfigField("pageSizeParam", "Page size parameter", "text", false, Placeholder: "per_page"),
                    new DataSourceConfigField("pageSize", "Page size", "number", false),
                    new DataSourceConfigField("maxPages", "Maximum pages", "number", false, HelpText: "Defaults to 20."),
                    new DataSourceConfigField("apiKey", "API key", "password", false, Secret: true),
                    new DataSourceConfigField("apiKeyHeader", "API key header", "text", false, Secret: true,
                        Placeholder: "X-API-Key"),
                    new DataSourceConfigField("token", "Bearer token", "password", false, Secret: true),
                    new DataSourceConfigField("username", "Username", "text", false, Secret: true),
                    new DataSourceConfigField("password", "Password", "password", false, Secret: true)
                ])
        ],
        AuthTypes: DataSourceAuthTypes.All,
        SqlProviders: sqlProviderFactory.SupportedProviders);

    private static string SerialiseConfig(Dictionary<string, object?>? config) =>
        config is null or { Count: 0 } ? "{}" : JsonSerializer.Serialize(config);

    private static string? EncryptCredentials(Dictionary<string, string>? credentials)
    {
        if (credentials is null or { Count: 0 }) return null;

        // Blank values would otherwise overwrite a real secret with an empty string.
        var populated = credentials
            .Where(kv => !string.IsNullOrWhiteSpace(kv.Value))
            .ToDictionary(kv => kv.Key, kv => kv.Value);

        return populated.Count == 0 ? null : ConnectionPasswordHelper.Encrypt(JsonSerializer.Serialize(populated));
    }

    private static string FirstNonBlank(params string?[] candidates) =>
        candidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c)) ?? "dataset";

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];

    private static DataSourceConnectionDto ToDto(DataSourceConnection e) => new(
        e.Id, e.ConnectionName, e.Kind, e.AuthType,
        HasCredentials: !string.IsNullOrWhiteSpace(e.CredentialsEncrypted),
        e.ConfigJson, e.LastStatus, e.LastErrorMessage, e.LastTestedAt, e.IsActive,
        e.TenantId, e.CreatedBy, e.CreatedAt, e.ModifiedBy, e.ModifiedAt);
}
