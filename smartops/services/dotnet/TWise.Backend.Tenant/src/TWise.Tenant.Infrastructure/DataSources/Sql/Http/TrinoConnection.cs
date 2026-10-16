using System.Text;
using System.Text.Json;

namespace TWise.Tenant.Infrastructure.DataSources.Sql.Http;

/// <summary>
/// Trino / Presto REST protocol: POST /v1/statement, then GET each nextUri until the server
/// stops returning one, collecting the column list and data pages along the way.
/// Database is "catalog" or "catalog.schema". A password switches on HTTP basic auth, which
/// Trino only accepts over https.
/// </summary>
public sealed class TrinoConnection(string connectionString) : HttpSqlConnection(connectionString)
{
    private const int MaxPages = 10_000;

    public override async Task<HttpSqlResult> ExecuteAsync(string sql, int timeoutSeconds, CancellationToken cancellationToken)
    {
        var user = string.IsNullOrWhiteSpace(Setting("Username")) ? "twise" : Setting("Username");
        var password = Setting("Password");
        var parts = Database.Split('.', 2, StringSplitOptions.TrimEntries);
        var baseUri = BaseUri;

        var columns = new List<string>();
        var types = new List<string>();
        var rows = new List<object?[]>();

        var request = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "v1/statement"))
        {
            Content = new StringContent(sql, Encoding.UTF8, "text/plain")
        };

        for (var page = 0; page < MaxPages; page++)
        {
            // Trino reads X-Trino-*, Presto reads X-Presto-*; the other side ignores the extra header.
            foreach (var prefix in new[] { "X-Trino-", "X-Presto-" })
            {
                request.Headers.Add(prefix + "User", user);
                if (parts[0].Length > 0) request.Headers.Add(prefix + "Catalog", parts[0]);
                if (parts.Length > 1 && parts[1].Length > 0) request.Headers.Add(prefix + "Schema", parts[1]);
            }
            if (password.Length > 0) request.Headers.Authorization = BasicAuth(user, password);

            string body;
            using (request)
            using (var response = await SendAsync(Http, request, timeoutSeconds, cancellationToken))
            {
                body = await response.Content.ReadAsStringAsync(cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new HttpSqlException($"Trino returned HTTP {(int)response.StatusCode}.");
            }

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            if (root.TryGetProperty("error", out var error))
            {
                var message = error.TryGetProperty("message", out var m) ? m.GetString() : null;
                throw new HttpSqlException(message ?? "Trino query failed.");
            }

            if (columns.Count == 0 && root.TryGetProperty("columns", out var cols))
            {
                foreach (var col in cols.EnumerateArray())
                {
                    columns.Add(col.GetProperty("name").GetString() ?? string.Empty);
                    types.Add(col.GetProperty("type").GetString() ?? string.Empty);
                }
            }

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

            if (!root.TryGetProperty("nextUri", out var nextProp) || nextProp.GetString() is not { } next)
                break;

            var nextUri = new Uri(next);
            if (!string.Equals(nextUri.Host, baseUri.Host, StringComparison.OrdinalIgnoreCase))
                throw new HttpSqlException("Trino redirected the query to a different host; refusing to follow.");

            request = new HttpRequestMessage(HttpMethod.Get, nextUri);
        }

        return columns.Count == 0 ? HttpSqlResult.Empty : new HttpSqlResult(columns, types, rows);
    }
}
