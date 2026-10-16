using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.DataSources.Connectors;

/// <summary>
/// Fetches JSON from an arbitrary HTTP endpoint and turns it into dataset rows.
///
/// Config (ConfigJson):
///   url             (required) absolute http/https URL
///   method          GET (default) | POST | PUT | PATCH
///   headers         object of extra request headers
///   queryParams     object of query-string values appended to the URL
///   body            request body sent with POST/PUT/PATCH, as a JSON value or string
///   rootPath        dotted path to the row array, e.g. "data.items"; omit when the body IS the array
///   pageParam       query parameter carrying the page number, enables pagination when set
///   pageSizeParam / pageSize   query parameter and value for the page size
///   maxPages        safety cap on pages fetched (default 20)
///
/// Credentials: {"apiKey","apiKeyHeader"} | {"token"} | {"username","password"}
///
/// Every outbound URL passes <see cref="OutboundUrlGuard"/> first, including each redirect hop,
/// because the URL is tenant-supplied and would otherwise reach the private network.
/// </summary>
public sealed class RestApiConnector(
    IHttpClientFactory httpClientFactory,
    ILogger<RestApiConnector> logger) : IDataSourceConnector
{
    /// <summary>Named client configured in DependencyInjection with redirects disabled.</summary>
    public const string HttpClientName = "DataSourceRestApi";

    private const int DefaultMaxPages = 20;
    private const int MaxRedirects = 3;
    private const long MaxResponseBytes = 8 * 1024 * 1024;
    private const int MaxRows = 10_000;

    public string Kind => DataSourceKinds.RestApi;

    public async Task<ConnectionTestResult> TestAsync(DataSourceConnection connection, CancellationToken cancellationToken = default)
    {
        try
        {
            var config = ReadConfig(connection);
            var result = await FetchPageAsync(connection, config, page: null, cancellationToken);

            return ConnectionTestResult.Ok(
                $"Connected successfully. Received {result.Rows.Count} row(s) and {result.Columns.Count} column(s).",
                result.Rows.Count);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or JsonException or TaskCanceledException)
        {
            logger.LogWarning(ex, "REST data source test failed for connection {ConnectionId}", connection.Id);
            return ConnectionTestResult.Fail(ex.Message);
        }
    }

    /// <summary>A REST connection addresses exactly one endpoint, so it lists a single object.</summary>
    public Task<IReadOnlyList<SourceObject>> ListObjectsAsync(DataSourceConnection connection, CancellationToken cancellationToken = default)
    {
        var config = ReadConfig(connection);
        IReadOnlyList<SourceObject> objects = [new SourceObject(config.Url, config.Url, "endpoint")];
        return Task.FromResult(objects);
    }

    public async Task<ParsedImportResult> FetchAsync(DataSourceConnection connection, string? objectRef, CancellationToken cancellationToken = default)
    {
        var config = ReadConfig(connection);

        // Single-page source: return the first page as-is.
        if (string.IsNullOrWhiteSpace(config.PageParam))
            return await FetchPageAsync(connection, config, page: null, cancellationToken);

        // Paginated source: walk pages until one comes back empty or the cap is hit.
        var allRows = new List<Dictionary<string, object?>>();
        List<Domain.DTOs.ImportColumnDto> columns = [];

        for (var page = 1; page <= config.MaxPages; page++)
        {
            var pageResult = await FetchPageAsync(connection, config, page, cancellationToken);
            if (pageResult.Rows.Count == 0) break;

            if (columns.Count == 0) columns = [.. pageResult.Columns];
            allRows.AddRange(pageResult.Rows);

            if (allRows.Count >= MaxRows)
            {
                logger.LogInformation(
                    "REST data source {ConnectionId} hit the {MaxRows}-row cap after {Pages} page(s)",
                    connection.Id, MaxRows, page);
                break;
            }
        }

        return new ParsedImportResult(columns, allRows.Take(MaxRows).ToList());
    }

    private async Task<ParsedImportResult> FetchPageAsync(
        DataSourceConnection connection, RestConfig config, int? page, CancellationToken cancellationToken)
    {
        var uri = BuildUri(config, page);
        using var response = await SendWithRedirectsAsync(connection, config, uri, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var preview = await ReadBodyPreviewAsync(response, cancellationToken);
            throw new InvalidOperationException(
                $"The endpoint returned {(int)response.StatusCode} {response.ReasonPhrase}. {preview}".TrimEnd());
        }

        if (response.Content.Headers.ContentLength > MaxResponseBytes)
            throw new InvalidOperationException(
                $"The response is larger than the {MaxResponseBytes / (1024 * 1024)}MB limit.");

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

        var rowArray = SelectRoot(doc.RootElement, config.RootPath);
        return TabularResultBuilder.FromJsonArray(rowArray);
    }

    /// <summary>
    /// Follows redirects manually so each hop's destination is re-checked by the guard.
    /// Automatic redirect handling would let a public URL bounce us to an internal one.
    /// </summary>
    private async Task<HttpResponseMessage> SendWithRedirectsAsync(
        DataSourceConnection connection, RestConfig config, Uri uri, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        var credentials = ReadCredentials(connection);

        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            await OutboundUrlGuard.EnsureAllowedAsync(uri, cancellationToken);

            using var request = BuildRequest(config, credentials, uri);
            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

            if (!IsRedirect(response) || response.Headers.Location is null) return response;

            var next = response.Headers.Location.IsAbsoluteUri
                ? response.Headers.Location
                : new Uri(uri, response.Headers.Location);

            response.Dispose();
            uri = next;
        }

        throw new InvalidOperationException($"The request exceeded {MaxRedirects} redirects.");
    }

    private static bool IsRedirect(HttpResponseMessage response) =>
        (int)response.StatusCode is 301 or 302 or 303 or 307 or 308;

    private static HttpRequestMessage BuildRequest(RestConfig config, Dictionary<string, string> credentials, Uri uri)
    {
        var method = config.Method.ToUpperInvariant() switch
        {
            "POST" => HttpMethod.Post,
            "PUT" => HttpMethod.Put,
            "PATCH" => HttpMethod.Patch,
            _ => HttpMethod.Get,
        };
        var request = new HttpRequestMessage(method, uri);

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        foreach (var (name, value) in config.Headers)
        {
            // Content headers must go on the body, not the request — skip rather than throw.
            if (!request.Headers.TryAddWithoutValidation(name, value))
                continue;
        }

        ApplyAuth(request, credentials);

        if (method != HttpMethod.Get && !string.IsNullOrWhiteSpace(config.Body))
            request.Content = new StringContent(config.Body, Encoding.UTF8, "application/json");

        return request;
    }

    private static void ApplyAuth(HttpRequestMessage request, Dictionary<string, string> credentials)
    {
        if (credentials.TryGetValue("token", out var token) && !string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return;
        }

        if (credentials.TryGetValue("apiKey", out var apiKey) && !string.IsNullOrWhiteSpace(apiKey))
        {
            var header = credentials.GetValueOrDefault("apiKeyHeader");
            if (string.IsNullOrWhiteSpace(header)) header = "X-API-Key";
            request.Headers.TryAddWithoutValidation(header, apiKey);
            return;
        }

        if (credentials.TryGetValue("username", out var username) && !string.IsNullOrWhiteSpace(username))
        {
            var password = credentials.GetValueOrDefault("password") ?? string.Empty;
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", encoded);
        }
    }

    private static Uri BuildUri(RestConfig config, int? page)
    {
        if (!Uri.TryCreate(config.Url, UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"'{config.Url}' is not a valid absolute URL.");

        var query = new List<string>();
        if (!string.IsNullOrEmpty(uri.Query)) query.Add(uri.Query.TrimStart('?'));

        foreach (var (key, value) in config.QueryParams)
            query.Add($"{Uri.EscapeDataString(key)}={Uri.EscapeDataString(value)}");

        if (page is not null && !string.IsNullOrWhiteSpace(config.PageParam))
        {
            query.Add($"{Uri.EscapeDataString(config.PageParam)}={page}");

            if (!string.IsNullOrWhiteSpace(config.PageSizeParam) && config.PageSize > 0)
                query.Add($"{Uri.EscapeDataString(config.PageSizeParam)}={config.PageSize}");
        }

        return new UriBuilder(uri) { Query = string.Join('&', query) }.Uri;
    }

    /// <summary>Walks a dotted path ("data.items") to the array holding the rows.</summary>
    private static JsonElement SelectRoot(JsonElement root, string? rootPath)
    {
        if (string.IsNullOrWhiteSpace(rootPath))
        {
            if (root.ValueKind == JsonValueKind.Array) return root;

            throw new InvalidOperationException(
                "The response is a JSON object, not an array. Set the row path (e.g. \"data\") to the property holding the rows.");
        }

        var current = root;
        foreach (var segment in rootPath.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out var next))
                throw new InvalidOperationException($"The row path '{rootPath}' does not exist in the response (missing '{segment}').");

            current = next;
        }

        if (current.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException($"The row path '{rootPath}' points to a {current.ValueKind}, not an array.");

        return current;
    }

    private static async Task<string> ReadBodyPreviewAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(body)) return string.Empty;

            return body.Length <= 200 ? body : body[..200] + "…";
        }
        catch (Exception)
        {
            // The status code is the useful part; a body we cannot read must not mask it.
            return string.Empty;
        }
    }

    private static RestConfig ReadConfig(DataSourceConnection connection)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(connection.ConfigJson) ? "{}" : connection.ConfigJson);
        var root = doc.RootElement;

        var url = GetString(root, "url");
        if (string.IsNullOrWhiteSpace(url))
            throw new InvalidOperationException("This REST data source has no 'url' configured.");

        return new RestConfig(
            Url: url,
            Method: GetString(root, "method") ?? "GET",
            Headers: GetStringMap(root, "headers"),
            QueryParams: GetStringMap(root, "queryParams"),
            Body: GetRaw(root, "body"),
            RootPath: GetString(root, "rootPath"),
            PageParam: GetString(root, "pageParam"),
            PageSizeParam: GetString(root, "pageSizeParam"),
            PageSize: GetInt(root, "pageSize") ?? 0,
            MaxPages: GetInt(root, "maxPages") ?? DefaultMaxPages);
    }

    private static Dictionary<string, string> ReadCredentials(DataSourceConnection connection)
    {
        if (string.IsNullOrWhiteSpace(connection.CredentialsEncrypted)) return [];

        var json = ConnectionPasswordHelper.Decrypt(connection.CredentialsEncrypted);
        return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? [];
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int? GetInt(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;

    private static string? GetRaw(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var v)) return null;
        return v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText();
    }

    private static Dictionary<string, string> GetStringMap(JsonElement root, string name)
    {
        var map = new Dictionary<string, string>();
        if (!root.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Object) return map;

        foreach (var prop in v.EnumerateObject())
        {
            var value = TabularResultBuilder.ReadScalar(prop.Value);
            if (value is not null) map[prop.Name] = value;
        }

        return map;
    }

    private sealed record RestConfig(
        string Url,
        string Method,
        Dictionary<string, string> Headers,
        Dictionary<string, string> QueryParams,
        string? Body,
        string? RootPath,
        string? PageParam,
        string? PageSizeParam,
        int PageSize,
        int MaxPages);
}
