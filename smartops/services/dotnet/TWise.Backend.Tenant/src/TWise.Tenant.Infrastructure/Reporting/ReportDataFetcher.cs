using System.Data;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Infrastructure.Reporting;

/// <summary>
/// Dynamically queries the tenant DB based on report config.
/// Applies filters and sorting at the SQL level.
/// Returns a DataTable for report data binding.
/// </summary>
public sealed class ReportDataFetcher(IConfiguration config)
{
    public async Task<DataTable> FetchDataAsync(
        string sourceName,
        string sourceType,
        ReportJsonConfig reportConfig,
        long tenantId,
        CancellationToken ct = default)
    {
        ValidateSourceName(sourceName);

        var visibleColumns = reportConfig.Columns.Where(c => c.Shown).ToList();
        if (visibleColumns.Count == 0) visibleColumns = reportConfig.Columns;

        // #3: Empty columns list → return empty DataTable instead of generating invalid SQL
        if (visibleColumns.Count == 0)
            return new DataTable("ReportDataSet");

        var columns = string.Join(", ", visibleColumns.Select(c => QuoteIdentifier(c.Field)));

        var sql = new StringBuilder();
        sql.Append($"SELECT TOP 10000 {columns} FROM [core].{QuoteIdentifier(sourceName)}");

        var parameters = new List<SqlParameter>();

        // Tenant isolation — restrict to the caller's tenant
        sql.Append(" WHERE [tenant_id] = @tenantId");
        parameters.Add(new SqlParameter("@tenantId", tenantId));

        // Apply dynamic filters
        if (reportConfig.Filters is { Count: > 0 })
        {
            foreach (var (filter, idx) in reportConfig.Filters.Select((f, i) => (f, i)))
            {
                var field = !string.IsNullOrWhiteSpace(filter.Field) ? filter.Field : filter.Key;
                if (string.IsNullOrWhiteSpace(field) || string.IsNullOrWhiteSpace(filter.Value))
                    continue;

                ValidateSourceName(field); // reuse identifier validation

                var paramName = $"@p{idx}";
                var clause = filter.Operator switch
                {
                    "eq" => $"{QuoteIdentifier(field)} = {paramName}",
                    "neq" => $"{QuoteIdentifier(field)} <> {paramName}",
                    "gt" => $"{QuoteIdentifier(field)} > {paramName}",
                    "lt" => $"{QuoteIdentifier(field)} < {paramName}",
                    "contains" => $"{QuoteIdentifier(field)} LIKE {paramName}",
                    _ => $"{QuoteIdentifier(field)} = {paramName}"
                };
                sql.Append($" AND {clause}");

                var value = filter.Operator == "contains"
                    ? $"%{EscapeLikePattern(filter.Value)}%"
                    : filter.Value;
                parameters.Add(new SqlParameter(paramName, value ?? (object)DBNull.Value));
            }
        }

        // Apply sorting
        if (reportConfig.SortBy is { Count: > 0 })
        {
            var orderClauses = reportConfig.SortBy.Select(s =>
                $"{QuoteIdentifier(s.Field)} {(s.Direction == "desc" ? "DESC" : "ASC")}");
            sql.Append($" ORDER BY {string.Join(", ", orderClauses)}");
        }

        // Execute
        var connectionString = config.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("Connection string 'TenantDb' is not configured.");
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);

        await using var cmd = new SqlCommand(sql.ToString(), conn);
        cmd.Parameters.AddRange(parameters.ToArray());
        cmd.CommandTimeout = 60;

        var dt = new DataTable("ReportDataSet");
        using var reader = await cmd.ExecuteReaderAsync(ct);
        dt.Load(reader);

        return dt;
    }

    private static void ValidateSourceName(string sourceName)
    {
        if (!Regex.IsMatch(sourceName, @"^[a-zA-Z_][a-zA-Z0-9_]*$"))
            throw new ArgumentException($"Invalid source name: '{sourceName}'");
    }

    private static string QuoteIdentifier(string identifier)
        => $"[{identifier.Replace("]", "]]")}]";

    /// <summary>Escapes SQL LIKE wildcards (%, _, [) to prevent pattern injection.</summary>
    private static string EscapeLikePattern(string value)
        => value.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]");
}
