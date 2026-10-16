using System.Text;
using System.Text.Json;

namespace TWise.Tenant.Infrastructure.DataSources.Sql.Http;

/// <summary>
/// ClickHouse over its HTTP interface (default port 8123): POST the SQL, read JSONCompact back.
/// Credentials travel in the X-ClickHouse-User / X-ClickHouse-Key headers so they never land in a URL.
/// </summary>
public sealed class ClickHouseConnection(string connectionString) : HttpSqlConnection(connectionString)
{
    public override async Task<HttpSqlResult> ExecuteAsync(string sql, int timeoutSeconds, CancellationToken cancellationToken)
    {
        var url = new UriBuilder(BaseUri)
        {
            Query = $"database={Uri.EscapeDataString(Database)}&default_format=JSONCompact"
        }.Uri;

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(sql, Encoding.UTF8, "text/plain")
        };
        request.Headers.Add("X-ClickHouse-User", Setting("Username"));
        request.Headers.Add("X-ClickHouse-Key", Setting("Password"));

        using var response = await SendAsync(Http, request, timeoutSeconds, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Only echo the body when ClickHouse itself produced it; anything else could be an
            // arbitrary HTTP endpoint and its content must not be surfaced.
            var isEngineError = response.Headers.Contains("X-ClickHouse-Exception-Code");
            throw new HttpSqlException(isEngineError
                ? body.Trim()[..Math.Min(body.Trim().Length, 500)]
                : $"ClickHouse returned HTTP {(int)response.StatusCode}.");
        }

        if (string.IsNullOrWhiteSpace(body)) return HttpSqlResult.Empty;

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        if (!root.TryGetProperty("meta", out var meta)) return HttpSqlResult.Empty;

        var columns = new List<string>();
        var types = new List<string>();
        foreach (var col in meta.EnumerateArray())
        {
            columns.Add(col.GetProperty("name").GetString() ?? string.Empty);
            types.Add(col.GetProperty("type").GetString() ?? string.Empty);
        }

        var rows = new List<object?[]>();
        if (root.TryGetProperty("data", out var data))
        {
            foreach (var row in data.EnumerateArray())
            {
                var values = new object?[columns.Count];
                var i = 0;
                foreach (var cell in row.EnumerateArray())
                {
                    if (i >= values.Length) break;
                    values[i] = ToValue(cell, types[i]);
                    i++;
                }
                rows.Add(values);
            }
        }

        return new HttpSqlResult(columns, types, rows);
    }
}
