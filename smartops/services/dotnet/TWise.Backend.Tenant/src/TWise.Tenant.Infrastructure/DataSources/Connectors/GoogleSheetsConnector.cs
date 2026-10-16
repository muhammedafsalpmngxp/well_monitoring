using System.Text.Json;
using Google;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Services;
using Google.Apis.Sheets.v4;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.DataSources.Connectors;

/// <summary>
/// Reads a Google Sheets spreadsheet. Each tab is a separately ingestable object; the first
/// row of a tab is treated as the header row.
///
/// Config: { "spreadsheetId": "…", "defaultSheet": "Sheet1" }
/// Credentials: { "refreshToken": "…" } — written by the OAuth callback.
/// </summary>
public sealed class GoogleSheetsConnector(
    IGoogleOAuthService oauth,
    ILogger<GoogleSheetsConnector> logger) : IDataSourceConnector
{
    private const string ApplicationName = "TWise SmartOps";

    /// <summary>Sheets caps a single values.get; this also matches the ImportedDataset row limit.</summary>
    private const int MaxRows = 10_000;

    public string Kind => DataSourceKinds.GoogleSheets;

    public async Task<ConnectionTestResult> TestAsync(DataSourceConnection connection, CancellationToken cancellationToken = default)
    {
        try
        {
            var objects = await ListObjectsAsync(connection, cancellationToken);
            return ConnectionTestResult.Ok($"Connected successfully. Found {objects.Count} sheet(s).", objects.Count);
        }
        catch (Exception ex) when (ex is InvalidOperationException or GoogleApiException or HttpRequestException)
        {
            logger.LogWarning(ex, "Google Sheets test failed for connection {ConnectionId}", connection.Id);
            return ConnectionTestResult.Fail(Describe(ex));
        }
    }

    public async Task<IReadOnlyList<SourceObject>> ListObjectsAsync(
        DataSourceConnection connection, CancellationToken cancellationToken = default)
    {
        var config = ReadConfig(connection);
        using var service = await CreateServiceAsync(connection, cancellationToken);

        var request = service.Spreadsheets.Get(config.SpreadsheetId);
        request.Fields = "sheets.properties(title,sheetId,gridProperties)";

        var spreadsheet = await request.ExecuteAsync(cancellationToken);

        return spreadsheet.Sheets?
            .Where(s => s.Properties is not null)
            .Select(s => new SourceObject(
                Ref: s.Properties.Title,
                Name: s.Properties.Title,
                ObjectType: "sheet",
                SizeBytes: null))
            .ToList() ?? [];
    }

    public async Task<ParsedImportResult> FetchAsync(
        DataSourceConnection connection, string? objectRef, CancellationToken cancellationToken = default)
    {
        var config = ReadConfig(connection);

        var sheetName = objectRef ?? config.DefaultSheet;
        if (string.IsNullOrWhiteSpace(sheetName))
        {
            // No tab chosen and none configured — fall back to the first tab in the spreadsheet.
            var objects = await ListObjectsAsync(connection, cancellationToken);
            sheetName = objects.FirstOrDefault()?.Ref
                ?? throw new InvalidOperationException("The spreadsheet has no sheets to read.");
        }

        using var service = await CreateServiceAsync(connection, cancellationToken);

        var request = service.Spreadsheets.Values.Get(config.SpreadsheetId, sheetName);
        // FORMATTED_VALUE returns what the user sees (dates, currency) rather than serial numbers.
        request.ValueRenderOption = SpreadsheetsResource.ValuesResource.GetRequest.ValueRenderOptionEnum.FORMATTEDVALUE;

        var response = await request.ExecuteAsync(cancellationToken);
        var values = response.Values;

        if (values is null || values.Count == 0)
            return new ParsedImportResult([], []);

        var grid = values
            .Take(MaxRows + 1) // +1 for the header row
            .Select(row => (IReadOnlyList<string?>)row.Select(cell => cell?.ToString()).ToList())
            .ToList();

        logger.LogInformation(
            "Fetched {RowCount} row(s) from Google sheet '{Sheet}' for connection {ConnectionId}",
            Math.Max(grid.Count - 1, 0), sheetName, connection.Id);

        return TabularResultBuilder.FromGrid(grid);
    }

    private async Task<SheetsService> CreateServiceAsync(DataSourceConnection connection, CancellationToken cancellationToken)
    {
        var accessToken = await ResolveAccessTokenAsync(oauth, connection, cancellationToken);

        return new SheetsService(new BaseClientService.Initializer
        {
            HttpClientInitializer = GoogleCredential.FromAccessToken(accessToken),
            ApplicationName = ApplicationName
        });
    }

    /// <summary>Mints a short-lived access token from the stored refresh token. Shared with the Drive connector.</summary>
    internal static async Task<string> ResolveAccessTokenAsync(
        IGoogleOAuthService oauth, DataSourceConnection connection, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(connection.CredentialsEncrypted))
            throw new InvalidOperationException("This Google data source is not authorised yet. Connect it with Google first.");

        var json = ConnectionPasswordHelper.Decrypt(connection.CredentialsEncrypted);
        var credentials = JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? [];

        if (!credentials.TryGetValue("refreshToken", out var refreshToken) || string.IsNullOrWhiteSpace(refreshToken))
            throw new InvalidOperationException("This Google data source has no refresh token. Re-connect it with Google.");

        return await oauth.GetAccessTokenAsync(refreshToken, cancellationToken);
    }

    /// <summary>Turns a Google API fault into a message worth showing a user.</summary>
    internal static string Describe(Exception ex) => ex switch
    {
        GoogleApiException { HttpStatusCode: System.Net.HttpStatusCode.NotFound } =>
            "The spreadsheet or file was not found. Check the ID and that the connected Google account can open it.",
        GoogleApiException { HttpStatusCode: System.Net.HttpStatusCode.Forbidden } =>
            "The connected Google account does not have permission to read this item.",
        GoogleApiException g => g.Error?.Message ?? g.Message,
        _ => ex.Message
    };

    private static SheetsConfig ReadConfig(DataSourceConnection connection)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(connection.ConfigJson) ? "{}" : connection.ConfigJson);
        var root = doc.RootElement;

        var spreadsheetId = root.TryGetProperty("spreadsheetId", out var id) ? id.GetString() : null;

        if (string.IsNullOrWhiteSpace(spreadsheetId))
            throw new InvalidOperationException("This Google Sheets data source has no 'spreadsheetId' configured.");

        var defaultSheet = root.TryGetProperty("defaultSheet", out var sheet) ? sheet.GetString() : null;

        return new SheetsConfig(spreadsheetId, defaultSheet);
    }

    private sealed record SheetsConfig(string SpreadsheetId, string? DefaultSheet);
}
