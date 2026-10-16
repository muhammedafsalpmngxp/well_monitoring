using System.Text.Json;
using Google;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Drive.v3;
using Google.Apis.Services;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.DataSources.Connectors;

/// <summary>
/// Reads CSV/Excel/JSON files out of Google Drive.
///
/// Downloaded bytes are handed to the existing <see cref="IFileImportParserService"/>, so a
/// Drive file and an uploaded file are parsed by exactly the same code. Native Google Sheets
/// files are exported as CSV on the way out; for those, the Sheets connector is the better
/// choice because it can address individual tabs.
///
/// Config: { "folderId": "…" } — optional; omit to list the whole accessible Drive.
/// Credentials: { "refreshToken": "…" }
/// </summary>
public sealed class GoogleDriveConnector(
    IGoogleOAuthService oauth,
    IFileImportParserService parser,
    ILogger<GoogleDriveConnector> logger) : IDataSourceConnector
{
    private const string ApplicationName = "TWise SmartOps";
    private const long MaxFileSizeBytes = 8 * 1024 * 1024;
    private const int MaxFilesListed = 200;

    private const string GoogleSheetMimeType = "application/vnd.google-apps.spreadsheet";

    /// <summary>Drive MIME types the file parser can handle, mapped to the parser's file-type key.</summary>
    private static readonly Dictionary<string, string> SupportedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["text/csv"] = "csv",
        ["application/csv"] = "csv",
        ["application/json"] = "json",
        ["text/json"] = "json",
        ["application/vnd.ms-excel"] = "xls",
        ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] = "xlsx",
        [GoogleSheetMimeType] = "csv" // exported as CSV
    };

    public string Kind => DataSourceKinds.GoogleDrive;

    public async Task<ConnectionTestResult> TestAsync(DataSourceConnection connection, CancellationToken cancellationToken = default)
    {
        try
        {
            var objects = await ListObjectsAsync(connection, cancellationToken);
            // Naming the account answers the usual "why is my folder empty" — the consent was
            // given with a different Google login than the one holding the files.
            using var service = await CreateServiceAsync(connection, cancellationToken);
            var about = service.About.Get();
            about.Fields = "user(emailAddress)";
            var email = (await about.ExecuteAsync(cancellationToken)).User?.EmailAddress;
            return ConnectionTestResult.Ok(
                $"Connected as {email ?? "an unknown account"}. Found {objects.Count} readable file(s).", objects.Count);
        }
        catch (Exception ex) when (ex is InvalidOperationException or GoogleApiException or HttpRequestException)
        {
            logger.LogWarning(ex, "Google Drive test failed for connection {ConnectionId}", connection.Id);
            return ConnectionTestResult.Fail(GoogleSheetsConnector.Describe(ex));
        }
    }

    public async Task<IReadOnlyList<SourceObject>> ListObjectsAsync(
        DataSourceConnection connection, CancellationToken cancellationToken = default)
    {
        var folderId = ReadFolderId(connection);
        using var service = await CreateServiceAsync(connection, cancellationToken);

        var request = service.Files.List();
        request.PageSize = MaxFilesListed;
        request.Fields = "files(id,name,mimeType,size)";
        // Folders in a shared drive are invisible to the default query.
        request.SupportsAllDrives = true;
        request.IncludeItemsFromAllDrives = true;

        var mimeFilter = string.Join(" or ", SupportedMimeTypes.Keys.Select(m => $"mimeType='{m}'"));
        request.Q = string.IsNullOrWhiteSpace(folderId)
            ? $"trashed=false and ({mimeFilter})"
            : $"trashed=false and '{folderId}' in parents and ({mimeFilter})";

        var response = await request.ExecuteAsync(cancellationToken);

        return response.Files?
            .Select(f => new SourceObject(f.Id, f.Name, f.MimeType, f.Size))
            .ToList() ?? [];
    }

    public async Task<ParsedImportResult> FetchAsync(
        DataSourceConnection connection, string? objectRef, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(objectRef))
            throw new InvalidOperationException("Choose a Drive file to import.");

        using var service = await CreateServiceAsync(connection, cancellationToken);

        var metadataRequest = service.Files.Get(objectRef);
        metadataRequest.Fields = "id,name,mimeType,size";
        metadataRequest.SupportsAllDrives = true;
        var file = await metadataRequest.ExecuteAsync(cancellationToken);

        if (!SupportedMimeTypes.TryGetValue(file.MimeType ?? string.Empty, out var fileType))
            throw new InvalidOperationException(
                $"'{file.Name}' is a {file.MimeType} file, which cannot be imported. Supported: CSV, JSON, XLS, XLSX and Google Sheets.");

        if (file.Size is > MaxFileSizeBytes)
            throw new InvalidOperationException(
                $"'{file.Name}' is larger than the {MaxFileSizeBytes / (1024 * 1024)}MB import limit.");

        using var buffer = new MemoryStream();

        if (string.Equals(file.MimeType, GoogleSheetMimeType, StringComparison.OrdinalIgnoreCase))
        {
            // A native Sheets file has no bytes to download — it must be exported.
            await service.Files.Export(objectRef, "text/csv").DownloadAsync(buffer, cancellationToken);
        }
        else
        {
            await service.Files.Get(objectRef).DownloadAsync(buffer, cancellationToken);
        }

        if (buffer.Length > MaxFileSizeBytes)
            throw new InvalidOperationException(
                $"'{file.Name}' is larger than the {MaxFileSizeBytes / (1024 * 1024)}MB import limit.");

        buffer.Position = 0;

        logger.LogInformation(
            "Downloaded Drive file '{FileName}' ({Bytes} bytes) for connection {ConnectionId}",
            file.Name, buffer.Length, connection.Id);

        // Reuse the upload parser so Drive files and uploaded files behave identically.
        return parser.Parse(buffer, file.Name, fileType);
    }

    private async Task<DriveService> CreateServiceAsync(DataSourceConnection connection, CancellationToken cancellationToken)
    {
        var accessToken = await GoogleSheetsConnector.ResolveAccessTokenAsync(oauth, connection, cancellationToken);

        return new DriveService(new BaseClientService.Initializer
        {
            HttpClientInitializer = GoogleCredential.FromAccessToken(accessToken),
            ApplicationName = ApplicationName
        });
    }

    private static string? ReadFolderId(DataSourceConnection connection)
    {
        if (string.IsNullOrWhiteSpace(connection.ConfigJson)) return null;

        using var doc = JsonDocument.Parse(connection.ConfigJson);
        return doc.RootElement.TryGetProperty("folderId", out var folder) ? folder.GetString() : null;
    }
}
