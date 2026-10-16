using Dapper;
using Microsoft.Data.SqlClient;

namespace SmartOps.Dashboard.Services;

/// <summary>
/// Background service that loads aggregated data from DB into memory on startup,
/// then refreshes every 5 minutes. One slow query = instant API responses forever.
/// </summary>
public sealed class DataLoaderService(
    IConfiguration config,
    DashboardDataStore store,
    ILogger<DataLoaderService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Load immediately on startup
        await LoadData(stoppingToken);

        // Refresh every 5 minutes
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
            await LoadData(stoppingToken);
        }
    }

    private async Task LoadData(CancellationToken ct)
    {
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            await using var db = new SqlConnection(config.GetConnectionString("AppMasterDB"));
            await db.OpenAsync(ct);

            log.LogInformation("DataLoader: connected to DB, loading data...");

            // 1. Load project-to-ODC mapping
            var odcProjects = await LoadProjectMapping(db, ct);

            // 2. Load aggregated task data (grouped by project + date)
            var rows = await LoadAggregatedData(db, ct);

            // 3. Create and publish new snapshot
            var snapshot = new DataSnapshot(rows, odcProjects);
            store.UpdateSnapshot(snapshot);

            sw.Stop();
            log.LogInformation(
                "DataLoader: loaded {RowCount} aggregated rows in {Elapsed:F1}s. Store is ready.",
                rows.Count, sw.Elapsed.TotalSeconds);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "DataLoader: failed to load data from DB");
        }
    }

    private static async Task<Dictionary<string, HashSet<string>>> LoadProjectMapping(
        SqlConnection db, CancellationToken ct)
    {
        var sql = "SELECT Code, ID FROM ProjectIDs WITH (NOLOCK)";
        var projects = await db.QueryAsync<(string Code, string ID)>(
            new CommandDefinition(sql, commandTimeout: 15, cancellationToken: ct));

        var mapping = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
        {
            ["nimr"] = new(StringComparer.OrdinalIgnoreCase),
            ["marmul"] = new(StringComparer.OrdinalIgnoreCase)
        };

        foreach (var (code, id) in projects)
        {
            if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(id))
                continue;

            if (code.StartsWith('N') || code.StartsWith('n'))
                mapping["nimr"].Add(id);
            else if (code.StartsWith('M') || code.StartsWith('m'))
                mapping["marmul"].Add(id);
        }

        return mapping;
    }

    private static async Task<IReadOnlyList<AggRow>> LoadAggregatedData(
        SqlConnection db, CancellationToken ct)
    {
        // Correct KPI logic per docx specification:
        // - Date dimension: target_start (NOT start_date)
        // - Completed: TRY_CAST(progress AS FLOAT) = 1 AND actual_end > 1901-01-01 (sentinel handling)
        // - In Progress: 0 < progress < 1 AND actual_start > 1901-01-01
        // - Not Started: progress = 0/NULL AND actual_start IS NULL/sentinel AND target_start < GETDATE()
        // - Not Yet Due: excluded from totals
        // ONLY loads NIMR and MARMUL projects (project codes starting with N or M).
        var sql = @"
            ;WITH categorized AS (
                SELECT
                    atp.project_id AS ProjectId,
                    COALESCE(NULLIF(atp.Well_ID, ''),
                        CASE 
                            WHEN CHARINDEX('-', atp.code) > 0 AND CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) > 0
                            THEN SUBSTRING(atp.code, CHARINDEX('-', atp.code) + 1, 
                                 CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) - CHARINDEX('-', atp.code) - 1)
                            ELSE ''
                        END) AS WellId,
                    CAST(atp.target_start AS DATE) AS TaskDate,
                    CASE
                        WHEN TRY_CAST(atp.progress AS FLOAT) = 1
                             AND atp.actual_end IS NOT NULL AND atp.actual_end > '1901-01-01'
                        THEN 'Completed'
                        WHEN TRY_CAST(atp.progress AS FLOAT) > 0
                             AND TRY_CAST(atp.progress AS FLOAT) < 1
                             AND atp.actual_start IS NOT NULL AND atp.actual_start > '1901-01-01'
                        THEN 'InProgress'
                        WHEN (atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' OR TRY_CAST(atp.progress AS FLOAT) = 0)
                             AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01')
                             AND atp.target_start < GETDATE()
                        THEN 'NotStarted'
                        WHEN (atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' OR TRY_CAST(atp.progress AS FLOAT) = 0)
                             AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01')
                             AND atp.target_start >= GETDATE()
                        THEN 'NotYetDue'
                        WHEN (atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' OR TRY_CAST(atp.progress AS FLOAT) = 0)
                             AND atp.actual_start IS NOT NULL AND atp.actual_start > '1901-01-01'
                        THEN 'InProgress'
                        ELSE 'Other'
                    END AS activity_status
                FROM ActivityTaskPlan atp WITH (NOLOCK)
                INNER JOIN ProjectIDs p WITH (NOLOCK) ON p.ID = atp.project_id
                WHERE atp.type = 'T'
                  AND atp.target_start IS NOT NULL
                  AND (p.Code LIKE 'N%' OR p.Code LIKE 'M%')
            )
            SELECT
                ProjectId,
                WellId,
                TaskDate,
                COUNT(CASE WHEN activity_status != 'NotYetDue' THEN 1 END) AS Total,
                SUM(CASE WHEN activity_status = 'Completed' THEN 1 ELSE 0 END) AS Completed,
                SUM(CASE WHEN activity_status = 'InProgress' THEN 1 ELSE 0 END) AS InProgress,
                SUM(CASE WHEN activity_status = 'NotStarted' THEN 1 ELSE 0 END) AS NotStarted
            FROM categorized
            WHERE activity_status != 'NotYetDue'
            GROUP BY ProjectId, WellId, TaskDate
            OPTION (MAXDOP 4)";

        var rows = await db.QueryAsync<AggRow>(
            new CommandDefinition(sql, commandTimeout: 300, cancellationToken: ct));

        return rows.ToList();
    }
}
