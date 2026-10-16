using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace SmartOps.Wells.API.Controllers;

/// <summary>
/// WMR (Weekly Management Report) API
///
/// GET /reports/wmr?cluster=All
///
/// Returns only the latest week's data from [dbo].[WMR], joined with
/// [dbo].[ProjectIDs] to resolve Cluster and Project from project_id.
///
/// Column names with periods (e.g. flow_line_const._status_in_progress_completed)
/// are sanitised by replacing '.' with '_' so JSON keys are valid JS identifiers.
/// </summary>
[ApiController]
[Route("reports")]
public sealed class WmrController(IConfiguration configuration, IMemoryCache cache) : ControllerBase
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(60);

    private string Cs => configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

    private const string Sql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- Determine the latest week date (handles both 'YYYY-MM-DD' and 'YY-MM-DD' formats)
DECLARE @LatestDate DATE = (
    SELECT MAX(COALESCE(
        TRY_CONVERT(DATE, CAST(w.Week_Number AS VARCHAR(20)), 23),
        TRY_CONVERT(DATE, '20' + CAST(w.Week_Number AS VARCHAR(20)), 23)
    ))
    FROM dbo.WMR w
    WHERE w.Week_Number IS NOT NULL
      AND CAST(w.Week_Number AS VARCHAR(20)) <> ''
);

SELECT
    ISNULL(p.[Cluster], '')               AS [Cluster],
    ISNULL(p.[Project], '')               AS [Project],
    CONVERT(VARCHAR(10), @LatestDate, 23) AS [ReportDate],
    w.*
FROM dbo.WMR w
LEFT JOIN dbo.ProjectIDs p ON p.[ID] = w.project_id
WHERE COALESCE(
    TRY_CONVERT(DATE, CAST(w.Week_Number AS VARCHAR(20)), 23),
    TRY_CONVERT(DATE, '20' + CAST(w.Week_Number AS VARCHAR(20)), 23)
) = @LatestDate
ORDER BY p.[Cluster], p.[Project], w.well_location, w.well_name_after_spud;
";

    [HttpGet("wmr")]
    public async Task<IActionResult> GetWmr(
        [FromQuery] string cluster = "All",
        CancellationToken ct = default)
    {
        const string allKey = "wmr::all";

        if (!cache.TryGetValue(allKey, out WmrCache? cached) || cached is null)
        {
            await using var conn = new SqlConnection(Cs);
            await conn.OpenAsync(ct);

            var allRows  = new List<Dictionary<string, object?>>();
            string? reportDate = null;
            var clusters = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

            await using var cmd = new SqlCommand(Sql, conn) { CommandTimeout = 120 };
            await using var rdr = await cmd.ExecuteReaderAsync(ct);

            while (await rdr.ReadAsync(ct))
            {
                var row = new Dictionary<string, object?>(rdr.FieldCount);

                for (int i = 0; i < rdr.FieldCount; i++)
                {
                    // Sanitise: replace '.' with '_' so field names are valid JS identifiers
                    var col = rdr.GetName(i).Replace('.', '_');
                    object? val = rdr.IsDBNull(i) ? null : rdr.GetValue(i);
                    // Normalise dates to ISO strings
                    if (val is DateTime dt)  val = dt.ToString("yyyy-MM-dd");
                    if (val is DateOnly   d) val = d.ToString("yyyy-MM-dd");
                    row[col] = val;
                }

                if (reportDate is null && row.TryGetValue("ReportDate", out var rd))
                    reportDate = rd?.ToString();

                if (row.TryGetValue("Cluster", out var cl) && cl is string cls && cls.Length > 0)
                    clusters.Add(cls);

                allRows.Add(row);
            }

            cached = new WmrCache(reportDate, [.. clusters], allRows);
            cache.Set(allKey, cached, CacheTtl);
        }

        // Cluster filter applied in-memory (dataset is small)
        List<Dictionary<string, object?>> rows = cluster == "All"
            ? cached.Rows
            : cached.Rows
                .Where(r => r.TryGetValue("Cluster", out var v) && v?.ToString() == cluster)
                .ToList();

        return Ok(new
        {
            reportDate = cached.ReportDate,
            clusters   = cached.Clusters,
            rows
        });
    }

    private sealed record WmrCache(
        string?                              ReportDate,
        string[]                             Clusters,
        List<Dictionary<string, object?>>    Rows);
}
