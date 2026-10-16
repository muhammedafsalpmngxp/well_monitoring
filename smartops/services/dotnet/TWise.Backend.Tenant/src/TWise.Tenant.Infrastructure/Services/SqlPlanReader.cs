using System.Globalization;
using System.Xml.Linq;
using Microsoft.Data.SqlClient;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// SQL Server's estimated execution plan (SET SHOWPLAN_XML ON compiles but never runs the batch),
/// reduced to the facts a reviewer needs: scans with their estimated rows, missing-index hints,
/// optimizer warnings and the total estimated cost.
/// </summary>
public static class SqlPlanReader
{
    private const int MaxListed = 8;
    private static readonly XNamespace Ns = "http://schemas.microsoft.com/sqlserver/2004/07/showplan";

    public static async Task<SqlPlanFacts> ReadAsync(string connectionString, string sql, CancellationToken ct)
    {
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await using (var on = conn.CreateCommand()) { on.CommandText = "SET SHOWPLAN_XML ON"; await on.ExecuteNonQueryAsync(ct); }
        var xml = new List<string>();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.CommandTimeout = 60;
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            do { while (await reader.ReadAsync(ct)) xml.Add(reader.GetString(0)); } while (await reader.NextResultAsync(ct));
        }
        finally
        {
            await using var off = conn.CreateCommand(); off.CommandText = "SET SHOWPLAN_XML OFF"; await off.ExecuteNonQueryAsync(ct);
        }
        return Summarise(xml);
    }

    public static SqlPlanFacts Summarise(IReadOnlyList<string> plans)
    {
        var scans = new List<(string text, double rows)>();
        var missing = new List<string>();
        var warnings = new List<string>();
        double cost = 0, rows = 0; var statements = 0;
        foreach (var doc in plans.Select(p => XDocument.Parse(p)))
        {
            foreach (var st in doc.Descendants(Ns + "StmtSimple"))
            {
                statements++;
                cost += Num(st.Attribute("StatementSubTreeCost")?.Value);
                rows += Num(st.Attribute("StatementEstRows")?.Value);
            }
            foreach (var op in doc.Descendants(Ns + "RelOp"))
            {
                var physical = op.Attribute("PhysicalOp")?.Value ?? "";
                if (!physical.EndsWith("Scan", StringComparison.Ordinal)) continue;
                var obj = op.Descendants(Ns + "Object").FirstOrDefault();
                var table = obj is null ? "?" : $"{Trim(obj.Attribute("Schema")?.Value)}.{Trim(obj.Attribute("Table")?.Value)}";
                var index = Trim(obj?.Attribute("Index")?.Value);
                var est = Num(op.Attribute("EstimateRows")?.Value);
                scans.Add(($"{physical} on {table}{(index is "" or null ? "" : $" ({index})")}: ~{est:N0} rows", est));
            }
            foreach (var mi in doc.Descendants(Ns + "MissingIndex"))
            {
                var table = $"{Trim(mi.Attribute("Schema")?.Value)}.{Trim(mi.Attribute("Table")?.Value)}";
                string Cols(string usage) => string.Join(", ", mi.Elements(Ns + "ColumnGroup").Where(g => g.Attribute("Usage")?.Value == usage)
                    .SelectMany(g => g.Elements(Ns + "Column")).Select(c => Trim(c.Attribute("Name")?.Value)));
                var impact = Num(mi.Parent?.Attribute("Impact")?.Value);
                var key = string.Join(", ", new[] { Cols("EQUALITY"), Cols("INEQUALITY") }.Where(s => s.Length > 0));
                var include = Cols("INCLUDE");
                missing.Add($"{table} ({key}){(include.Length > 0 ? $" INCLUDE ({include})" : "")} — estimated impact {impact:N0}%");
            }
            foreach (var w in doc.Descendants(Ns + "Warnings").Elements())
            {
                var text = w.Name.LocalName;
                if (w.Attribute("Expression") is { } e) text += ": " + e.Value;
                else if (w.Attribute("ConvertIssue") is { } ci) text += " (" + ci.Value + ")";
                if (!warnings.Contains(text)) warnings.Add(text);
            }
        }
        return new SqlPlanFacts(statements, scans.OrderByDescending(s => s.rows).Take(MaxListed).Select(s => s.text).ToList(),
            missing.Take(MaxListed).ToList(), warnings.Take(MaxListed).ToList(), Math.Round(cost, 3), Math.Round(rows));
    }

    private static double Num(string? s) => double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
    private static string Trim(string? s) => (s ?? "").Trim('[', ']');
}
