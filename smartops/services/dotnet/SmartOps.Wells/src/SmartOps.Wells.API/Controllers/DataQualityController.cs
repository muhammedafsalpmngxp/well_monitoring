using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace SmartOps.Wells.API.Controllers;

/// <summary>
/// Data Reliability API — queries every source table used by each KPI tile on
/// every request (no hardcoded values) and scores reliability across 5 dimensions:
///
///   Completeness  30% — critical fields are populated
///   Validity      20% — values are in the correct format / range
///   Consistency   25% — related fields agree; no structural format mismatch
///   Integrity     15% — no duplicates, referential links hold
///   Freshness     10% — data is recent enough to trust
///
/// GET /data-quality/tile?tile=totalWells|completedWells|odcStatus|drilledWells|dueWells|penaltyExposure|bonusPotential
/// GET /data-quality/all
/// </summary>
[ApiController]
[Route("data-quality")]
public sealed class DataQualityController(IConfiguration configuration) : ControllerBase
{
    // ── Weights (must sum to 1.0) ─────────────────────────────────────────────
    private const double W_Completeness = 0.30;
    private const double W_Validity     = 0.20;
    private const double W_Consistency  = 0.25;
    private const double W_Integrity    = 0.15;
    private const double W_Freshness    = 0.10;

    private string Cs => configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

    // ── DB helpers ────────────────────────────────────────────────────────────
    private SqlConnection Open()
    {
        var conn = new SqlConnection(Cs);
        conn.Open();
        return conn;
    }

    private static async Task<long> Count(SqlConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(sql, c) { CommandTimeout = 60 };
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is null || v == DBNull.Value ? 0 : Convert.ToInt64(v);
    }

    private static async Task<string?> Scalar(SqlConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(sql, c) { CommandTimeout = 60 };
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is null || v == DBNull.Value ? null : v.ToString();
    }

    private static async Task<List<Dictionary<string, object?>>> Rows(
        SqlConnection c, string sql, int max = 5, CancellationToken ct = default)
    {
        var list = new List<Dictionary<string, object?>>();
        await using var cmd = new SqlCommand(sql, c) { CommandTimeout = 30 };
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct) && list.Count < max)
        {
            var row = new Dictionary<string, object?>();
            for (int i = 0; i < r.FieldCount; i++)
                row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
            list.Add(row);
        }
        return list;
    }

    // ── Scoring helpers ───────────────────────────────────────────────────────
    /// <summary>
    /// Rate = 1 − (bad / total), clamped to [0,1].
    /// Returns 1.0 when total = 0 (empty table — callers must handle N/A via NaScore).
    /// </summary>
    private static double Rate(long bad, long total) =>
        total <= 0 ? 1.0 : Math.Max(0, 1.0 - (double)bad / total);

    /// <summary>
    /// Freshness score: 1.0 while age ≤ target days, then linear decay to 0.0 over
    /// the following window days. Formula: max(0, 1 − (age − target) / window).
    /// Matches client methodology §3.5 — configurable target + window per table.
    /// </summary>
    private static double FreshnessRate(int ageDays, int targetDays, int windowDays) =>
        ageDays <= targetDays
            ? 1.0
            : Math.Max(0.0, 1.0 - (double)(ageDays - targetDays) / windowDays);

    /// <summary>
    /// Returns -1.0 (N/A sentinel) when the table has 0 rows; otherwise returns score.
    /// Empty tables must not contribute to roll-ups or show as 100% reliable.
    /// </summary>
    private static double NaScore(long totalRows, double score) =>
        totalRows <= 0 ? -1.0 : score;

    private static double WeightedScore(
        double completeness, double validity,
        double consistency, double integrity, double freshness) =>
        Math.Round(
            (completeness * W_Completeness +
             validity     * W_Validity     +
             consistency  * W_Consistency  +
             integrity    * W_Integrity    +
             freshness    * W_Freshness) * 100, 1);

    /// <summary>
    /// Applies the critical-dimension gate: if Completeness or Integrity falls below
    /// the critical floor (0.40), the overall score is capped at floor × 100.
    /// Prevents a high average from masking a critically broken dimension.
    /// Matches client methodology §4.5 / §5.4.
    /// </summary>
    private static double ApplyGate(double score, double completeness, double integrity,
        double criticalFloor = 0.40) =>
        completeness < criticalFloor || integrity < criticalFloor
            ? Math.Min(score, Math.Round(criticalFloor * 100, 1))
            : score;

    /// <summary>
    /// Score band labels — matches client methodology §6:
    ///   Trusted  80–100  fine for reporting and decisions
    ///   Good     65–79   usable, with minor issues to keep an eye on
    ///   Fair     40–64   use carefully; fixes should be planned
    ///   Poor     &lt;40    not for decisions until sorted
    ///   N/A      −1.0   table is empty / not loaded
    /// </summary>
    private static string Label(double score) =>
        score < 0   ? "N/A"     :
        score >= 80 ? "Trusted" :
        score >= 65 ? "Good"    :
        score >= 40 ? "Fair"    : "Poor";

    // ── Issue builder ─────────────────────────────────────────────────────────
    private static object Issue(
        string field, string description, string dimension,
        string severity, long affected, List<Dictionary<string, object?>>? samples = null)
        => new
        {
            field,
            description,
            dimension,     // Completeness | Validity | Consistency | Integrity | Freshness
            severity,      // High | Medium | Low
            affected,
            status = "Open",
            sampleRows = (object?)samples ?? Array.Empty<object>()
        };

    // ── Response builder ──────────────────────────────────────────────────────
    private static object BuildResponse(
        string tile, string description,
        double overallScore,
        List<object> tables)
        => new
        {
            tile,
            description,
            overallReliabilityScore = overallScore,
            overallReliabilityLabel = Label(overallScore),
            scoringDimensions = new
            {
                completeness = new { weight = "30%", description = "Important fields populated" },
                validity     = new { weight = "20%", description = "Correct formats / ranges" },
                consistency  = new { weight = "25%", description = "Related fields agree; mixed formats flagged" },
                integrity    = new { weight = "15%", description = "Duplicates / referential links" },
                freshness    = new { weight = "10%", description = "Recent timestamps" }
            },
            tables
        };

    // ── Schema-level constraint checker ──────────────────────────────────────
    /// <summary>
    /// Queries INFORMATION_SCHEMA to determine whether a table has a PRIMARY KEY
    /// and whether a specified column is backed by a FOREIGN KEY constraint.
    /// Returns a structural integrity penalty (row-equivalent count) and pre-built
    /// Issue objects to be merged into the tile's issues list.
    /// </summary>
    private static async Task<(long penalty, List<object> issues)> StructuralIntegrity(
        SqlConnection conn,
        string tableName,
        long totalRows,
        string? fkColumn = null,
        string? fkRefDesc = null,
        CancellationToken ct = default)
    {
        var pkSql =
            $"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS " +
            $"WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='{tableName}' AND CONSTRAINT_TYPE='PRIMARY KEY'";
        bool hasPk = await Count(conn, pkSql, ct) > 0;

        bool hasFk = true;
        if (fkColumn != null)
        {
            var fkSql =
                $"SELECT COUNT(*) FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc " +
                $"INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu " +
                $"  ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME " +
                $"  AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA " +
                $"WHERE kcu.TABLE_SCHEMA='dbo' AND kcu.TABLE_NAME='{tableName}' " +
                $"  AND kcu.COLUMN_NAME='{fkColumn}'";
            hasFk = await Count(conn, fkSql, ct) > 0;
        }

        long penalty = 0;
        var issues   = new List<object>();

        if (!hasPk)
        {
            penalty += Math.Max(1, totalRows / 10);
            issues.Add(Issue(
                $"(schema) PRIMARY KEY missing — dbo.{tableName}",
                $"dbo.{tableName} has no PRIMARY KEY constraint defined in INFORMATION_SCHEMA. " +
                $"The database engine cannot prevent duplicate rows at insert time — duplicates are " +
                $"only detected at query time via ROW_NUMBER() or GROUP BY, and an arbitrary row " +
                $"may be chosen when deduplicating snapshots.",
                "Integrity", "High", totalRows));
        }

        if (fkColumn != null && !hasFk)
        {
            penalty += Math.Max(1, totalRows / 10);
            issues.Add(Issue(
                $"(schema) FOREIGN KEY missing — dbo.{tableName}.{fkColumn} → {fkRefDesc ?? "parent table"}",
                $"dbo.{tableName} has no FOREIGN KEY constraint on [{fkColumn}] referencing " +
                $"{fkRefDesc ?? "the parent table"}. Referential integrity is not enforced by the " +
                $"database — rows with orphan [{fkColumn}] values can be inserted without error, " +
                $"causing silent join failures that hide data from KPI counts.",
                "Integrity", "High", totalRows));
        }

        return (penalty, issues);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Endpoints
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("metadata/tables")]
    public async Task<IActionResult> MetadataTables(CancellationToken ct = default)
    {
        await using var conn = Open();
        const string sql = @"
            SELECT s.name AS schema_name, t.name AS table_name
            FROM sys.tables t
            INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE t.is_ms_shipped = 0
            ORDER BY s.name, t.name;";

        var tables = new List<object>();
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var schemaName = reader.GetString(0);
            var tableName = reader.GetString(1);
            tables.Add(new
            {
                schemaName,
                tableName,
                qualifiedName = $"{schemaName}.{tableName}"
            });
        }

        return Ok(new { tables });
    }

    [HttpGet("metadata/columns")]
    public async Task<IActionResult> MetadataColumns(
        [FromQuery] string schemaName,
        [FromQuery] string tableName,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(schemaName) || string.IsNullOrWhiteSpace(tableName))
            return BadRequest("Both schemaName and tableName are required.");

        await using var conn = Open();
        const string sql = @"
            SELECT c.name AS column_name,
                   tp.name AS data_type,
                   CASE WHEN ic.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
            FROM sys.columns c
            INNER JOIN sys.tables t ON t.object_id = c.object_id
            INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
            INNER JOIN sys.types tp ON tp.user_type_id = c.user_type_id
            LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
            LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.column_id = c.column_id
            WHERE s.name = @schemaName
              AND t.name = @tableName
            ORDER BY c.column_id;";

        var columns = new List<object>();
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.AddWithValue("@schemaName", schemaName);
        cmd.Parameters.AddWithValue("@tableName", tableName);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            columns.Add(new { name = reader.GetString(0), dataType = reader.GetString(1), isPrimaryKey = reader.GetInt32(2) == 1 });

        return Ok(new
        {
            schemaName,
            tableName,
            qualifiedName = $"{schemaName}.{tableName}",
            columns
        });
    }

    [HttpGet("tile")]
    public async Task<IActionResult> SingleTile(
        [FromQuery] string tile = "totalWells",
        CancellationToken ct = default)
    {
        var result = tile switch
        {
            "completedWells"  => await QualityCompletedWells(ct),
            "odcStatus"       => await QualityOdcStatus(ct),
            "drilledWells"    => await QualityDrilledWells(ct),
            "dueWells"              => await QualityDueWells(ct),
            "dueWellsCompletion"    => await QualityDueWellsCompletion(ct),
            "dueWellsCompletionTrend" => await QualityDueWellsCompletionTrend(ct),
            "penaltyExposure"       => await QualityPenaltyExposure(ct),
            "bonusPotential"  => await QualityBonusPotential(ct),
            "globalFilter"    => await QualityGlobalFilter(ct),
            "crewPRating"       => await QualityCrewPRating(ct),
            "wpaReadiness"      => await QualityWpaReadiness(ct),
            "clusterHealth"     => await QualityClusterHealth(ct),
            "clusterWellProgress" => await QualityClusterWellProgress(ct),
            "hookupProgress"        => await QualityHookupProgress(ct),
            "constructionProgress" => await QualityConstructionProgress(ct),
            "wroOverall"           => await QualityWroOverall(ct),
            "wroFlowline"          => await QualityWroFlowline(ct),
            "wroOhl"               => await QualityWroOhl(ct),
            "wroBuffer"            => await QualityWroBuffer(ct),
            _                      => await QualityTotalWells(ct)
        };
        return Ok(result);
    }

    [HttpGet("all")]
    public async Task<IActionResult> All(CancellationToken ct = default)
    {
        // Run sequentially — same DB connection pool, avoids overwhelming the DB
        var results = new List<object>
        {
            await QualityTotalWells(ct),
            await QualityCompletedWells(ct),
            await QualityOdcStatus(ct),
            await QualityDrilledWells(ct),
            await QualityDueWells(ct),
            await QualityDueWellsCompletion(ct),
            await QualityDueWellsCompletionTrend(ct),
            await QualityPenaltyExposure(ct),
            await QualityBonusPotential(ct),
            await QualityGlobalFilter(ct),
            await QualityCrewPRating(ct),
            await QualityWpaReadiness(ct),
            await QualityClusterHealth(ct),
            await QualityClusterWellProgress(ct),
            await QualityHookupProgress(ct),
            await QualityConstructionProgress(ct),
            await QualityWroOverall(ct),
            await QualityWroFlowline(ct),
            await QualityWroOhl(ct),
            await QualityWroBuffer(ct)
        };
        return Ok(results);
    }

    // =========================================================================
    // 1. TOTAL WELLS — dbo.WMR + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityTotalWells(CancellationToken ct)
    {
        await using var conn = Open();

        // ── dbo.WMR ──────────────────────────────────────────────────────────
        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness
        var nullWellId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullProgress  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NULL", ct);
        var nullWeek      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE Week_Number IS NULL OR Week_Number=''", ct);

        // Validity
        var badProgress   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE TRY_CAST(over_all_progress_percentages AS FLOAT) NOT BETWEEN 0 AND 1", ct);

        // Consistency — dual Week_Number format (YY-MM-DD vs YYYY-MM-DD). Both parse OK via
        // COALESCE workaround but the mixed format is a structural data-quality issue.
        var weekShortFmt  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLongFmt   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var weekBothExist = weekShortFmt > 0 && weekLongFmt > 0 ? 1L : 0L; // flag: mixed formats coexist
        // Type-mismatch join: WMR.project_id (NVARCHAR/GUID) vs ProjectIDs.ID (numeric) — requires CAST
        var noProjectMatch= await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100))=w.project_id)", ct);

        // Integrity
        var dupWellWeek   = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        var multiProject  = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);

        // Freshness — days since latest WMR snapshot
        var latestWeek    = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSinceUpdate = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSinceUpdate, 7, 28);

        // Scores
        var (wmrStructPenalty, wmrStructIssues) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double completeness = Rate(nullWellId + nullProgress + nullWeek, wmrTotal * 3);
        double validity     = Rate(badProgress, wmrTotal);
        // Consistency penalises: mixed-format Week_Number + wells with no project match
        double consistency  = Rate(
            (weekBothExist > 0 ? Math.Min(weekShortFmt, weekLongFmt) : 0) + noProjectMatch,
            wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + multiProject + wmrStructPenalty, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        // Sample rows
        var sampleDups = await Rows(conn,
            "SELECT TOP 5 pdo_well_id, Week_Number, COUNT(*) AS row_count " +
            "FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "GROUP BY pdo_well_id, Week_Number HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC", 5, ct);
        var sampleMultiProj = await Rows(conn,
            "SELECT TOP 5 pdo_well_id, COUNT(DISTINCT project_id) AS project_count " +
            "FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL " +
            "GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1", 5, ct);

        var wmrIssues = new List<object>();
        if (nullWellId > 0)    wmrIssues.Add(Issue("pdo_well_id", $"{nullWellId} rows have NULL/empty pdo_well_id — those wells are invisible to all tile counts", "Completeness", "High", nullWellId));
        if (nullProgress > 0)  wmrIssues.Add(Issue("over_all_progress_percentages", $"{nullProgress} rows have NULL progress — treated as 0% by COALESCE, may understate active well counts", "Completeness", "Medium", nullProgress));
        if (nullWeek > 0)      wmrIssues.Add(Issue("Week_Number", $"{nullWeek} rows have NULL Week_Number — excluded from all date-filtered queries", "Completeness", "High", nullWeek));
        if (badProgress > 0)   wmrIssues.Add(Issue("over_all_progress_percentages", $"{badProgress} rows have progress outside 0–1 range — status classification (active/completed) unreliable for these wells", "Validity", "Medium", badProgress));
        if (weekBothExist > 0) wmrIssues.Add(Issue("Week_Number", $"{weekShortFmt} rows use YY-MM-DD (8-char) and {weekLongFmt} rows use YYYY-MM-DD (10-char). Mixed formats coexist — a COALESCE workaround handles both, but the inconsistency is a data-entry quality issue. Without the fix, the 8-char rows would be silently excluded from every date filter.", "Consistency", "High", weekShortFmt + weekLongFmt));
        if (noProjectMatch > 0)wmrIssues.Add(Issue("project_id", $"{noProjectMatch} distinct wells have a project_id that does not match any ProjectIDs.ID (after CAST to NVARCHAR). Cause: WMR.project_id stores a GUID/string while ProjectIDs.ID is numeric — no FK constraint enforces this join.", "Consistency", "High", noProjectMatch));
        if (dupWellWeek > 0)   wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} (pdo_well_id, Week_Number) pairs have more than one row. ROW_NUMBER() picks one arbitrarily — progress value used for counting depends on which row wins the sort.", "Integrity", "High", dupWellWeek, sampleDups));
        if (multiProject > 0)  wmrIssues.Add(Issue("pdo_well_id / project_id", $"{multiProject} wells appear under more than one project_id. The same well is independently counted in each cluster/project it appears in — causing double-counting in totals.", "Integrity", "High", multiProject, sampleMultiProj));
        if (daysSinceUpdate > 7) wmrIssues.Add(Issue("Week_Number", $"Latest WMR snapshot is {daysSinceUpdate} days old ({latestWeek}). KPI counts reflect stale data.", "Freshness", daysSinceUpdate > 14 ? "High" : "Medium", daysSinceUpdate));
        wmrIssues.AddRange(wmrStructIssues);

        // ── dbo.ProjectIDs ───────────────────────────────────────────────────
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        var (pidStructPenalty, pidStructIssues) = await StructuralIntegrity(conn, "ProjectIDs", pidTotal, null, null, ct);
        double pidComplete = Rate(pidNullId + pidNullClust, pidTotal * 2);
        double pidInteg    = Rate(noProjectMatch + pidStructPenalty, Math.Max(distinctWells + pidStructPenalty, 1));
        double pidScore    = NaScore(pidTotal, ApplyGate(WeightedScore(pidComplete, 1.0, 1.0, pidInteg, 1.0), pidComplete, pidInteg));

        var pidIssues = new List<object>();
        if (noProjectMatch > 0) pidIssues.Add(Issue("ID (join to WMR.project_id)", $"{noProjectMatch} WMR wells have a project_id that matches no ProjectIDs.ID (after CAST). No FK constraint enforces this join — those wells are silently orphaned from all filtered counts.", "Integrity", "High", noProjectMatch));
        if (pidNullId > 0)      pidIssues.Add(Issue("ID", $"{pidNullId} rows have NULL ID — those project records can never be matched to WMR rows", "Completeness", "High", pidNullId));
        if (pidNullClust > 0)   pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — those wells are excluded from cluster-filtered counts", "Completeness", "Medium", pidNullClust));
        pidIssues.AddRange(pidStructIssues);

        // Overall for this tile
        double overall = wmrScore * 0.65 + pidScore * 0.35;

        return BuildResponse("totalWells",
            "Total Wells KPI tile. Sources: dbo.WMR (weekly snapshots) + dbo.ProjectIDs. " +
            "Active/Inactive split derived from WMR status fields.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",        totalRows = wmrTotal,  reliabilityScore = wmrScore, reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.ProjectIDs", totalRows = pidTotal,  reliabilityScore = pidScore, reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // 2. COMPLETED WELLS — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History
    // =========================================================================
    private async Task<object> QualityCompletedWells(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness: SAP expected rig-on date is needed to classify Due vs Non-Due
        var nullSapRigOn = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);
        // Completed wells missing SAP rig-on → forced into Non-Due bucket regardless of actual delivery timing
        var completedNoSapRigOn = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE TRY_CAST(over_all_progress_percentages AS FLOAT) >= 1.0 " +
            "AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);

        // Integrity: duplicate (well_id, week) — snapshot quality
        var dupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);

        var (wmrStructPenaltyC, wmrStructIssuesC) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double wmrComplete = Rate(nullSapRigOn, wmrTotal);
        double wmrInteg    = Rate(dupWellWeek + wmrStructPenaltyC, wmrTotal);
        double wmrScore    = NaScore(wmrTotal, ApplyGate(WeightedScore(wmrComplete, 1.0, 1.0, wmrInteg, freshnessRate), wmrComplete, wmrInteg));

        var wmrIssues = new List<object>();
        if (nullSapRigOn > 0)       wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{nullSapRigOn} rows are missing the SAP expected rig-on date. This field determines whether a completed well is classified as Due or Non-Due. Missing = forced into Non-Due.", "Completeness", "High", nullSapRigOn));
        if (completedNoSapRigOn > 0)wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{completedNoSapRigOn} wells have progress=100% but no SAP expected rig-on date — they always land in Non-Due regardless of when they were actually completed.", "Completeness", "Medium", completedNoSapRigOn));
        if (dupWellWeek > 0)        wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — ROW_NUMBER snapshot picks one row arbitrarily; progress used for Due/Non-Due split depends on which row is chosen.", "Integrity", "High", dupWellWeek));
        if (days > 7)               wmrIssues.Add(Issue("Week_Number", $"Latest snapshot is {days} days old ({latestWeek}) — completed well counts may not reflect recent activity.", "Freshness", days > 14 ? "High" : "Medium", days));
        wmrIssues.AddRange(wmrStructIssuesC);

        // ── SAP table ────────────────────────────────────────────────────────
        var sapTotal       = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapBadStart    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var sapBadEnd      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE TRY_CAST(EarliestEndDate AS DATE) IS NULL", ct);
        var sapEndBeforeStart = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE TRY_CAST(EarliestEndDate AS DATE) IS NOT NULL AND TRY_CAST(Earl_start_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(EarliestEndDate AS DATE) < TRY_CAST(Earl_start_date AS DATE)", ct);
        var noSapForActive = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND TRY_CAST(w.over_all_progress_percentages AS FLOAT)>0 " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        var sapSamples = await Rows(conn,
            "SELECT TOP 5 Well_ID, Earl_start_date, EarliestEndDate FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE TRY_CAST(EarliestEndDate AS DATE) IS NOT NULL AND TRY_CAST(Earl_start_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(EarliestEndDate AS DATE) < TRY_CAST(Earl_start_date AS DATE)", 5, ct);

        var (sapStructPenaltyC, sapStructIssuesC) = await StructuralIntegrity(conn, "SAP_DRILLING_SEQUENCE_History", sapTotal, "Well_ID", "WMR.pdo_well_id", ct);
        double sapComplete = Rate(sapNullWellId + sapBadStart + sapBadEnd, sapTotal * 3);
        double sapValid    = Rate(sapEndBeforeStart, sapTotal);
        double sapInteg    = Rate(noSapForActive + sapStructPenaltyC, Math.Max(distinctWells + sapStructPenaltyC, 1));
        double sapScore    = NaScore(sapTotal, ApplyGate(WeightedScore(sapComplete, sapValid, 1.0, sapInteg, 1.0), sapComplete, sapInteg));

        var sapIssues = new List<object>();
        if (sapNullWellId > 0)    sapIssues.Add(Issue("Well_ID", $"{sapNullWellId} SAP rows have NULL Well_ID — cannot be joined to WMR.pdo_well_id; planned dates are unavailable for those wells", "Completeness", "High", sapNullWellId));
        if (sapBadStart > 0)      sapIssues.Add(Issue("Earl_start_date", $"{sapBadStart} rows have an unparseable plan start date — those wells have no planned baseline, variance calculation is skipped", "Validity", "Medium", sapBadStart));
        if (sapBadEnd > 0)        sapIssues.Add(Issue("EarliestEndDate", $"{sapBadEnd} rows have an unparseable plan end date", "Validity", "Medium", sapBadEnd));
        if (sapEndBeforeStart > 0)sapIssues.Add(Issue("Earl_start_date / EarliestEndDate", $"{sapEndBeforeStart} rows where plan end < plan start — negative plan duration; variance calculation produces nonsense for these wells", "Consistency", "High", sapEndBeforeStart, sapSamples));
        if (noSapForActive > 0)   sapIssues.Add(Issue("Well_ID", $"{noSapForActive} active WMR wells have no SAP record at all — planned baseline is NULL, variance is NULL, Due/Non-Due classification is impossible", "Integrity", "High", noSapForActive));
        sapIssues.AddRange(sapStructIssuesC);

        double overall = wmrScore * 0.55 + sapScore * 0.45;

        return BuildResponse("completedWells",
            "Completed Wells KPI tile (Due / Non-Due split). Sources: dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal,  reliabilityScore = wmrScore, reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal,  reliabilityScore = sapScore, reliabilityLabel = Label(sapScore), issues = sapIssues }
            });
    }

    // =========================================================================
    // 3. ODC OVERALL STATUS — dbo.WMR + dbo.WMR_TaskPlan_csv_imported
    // =========================================================================
    private async Task<object> QualityOdcStatus(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Consistency: dual Week_Number format
        var weekShort = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);

        // Validity: date fields used by ODC category logic
        var badRigOn   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE actual_rig_on_date IS NOT NULL AND TRY_CAST(actual_rig_on_date AS DATE) IS NULL", ct);
        var badRigOff  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE actual_rig_off_date IS NOT NULL AND TRY_CAST(actual_rig_off_date AS DATE) IS NULL", ct);
        var badCommPct = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE overall_comm_progress_100 IS NOT NULL AND TRY_CAST(overall_comm_progress_100 AS FLOAT) NOT BETWEEN 0 AND 1", ct);

        // Integrity
        var dupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);

        var (wmrStructPenaltyO, wmrStructIssuesO) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double consistency = weekShort > 0 && weekLong > 0
            ? Rate(Math.Min(weekShort, weekLong), wmrTotal) : 1.0;
        double validity   = Rate(badRigOn + badRigOff + badCommPct, wmrTotal * 3);
        double integrity  = Rate(dupWellWeek + wmrStructPenaltyO, wmrTotal);
        double wmrScore   = NaScore(wmrTotal, ApplyGate(WeightedScore(1.0, validity, consistency, integrity, freshnessRate), 1.0, integrity));

        var wmrIssues = new List<object>();
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed date formats: {weekShort} rows use YY-MM-DD (8-char) and {weekLong} rows use YYYY-MM-DD. The COALESCE fix resolves both, but without it, the 8-char rows are silently excluded from the ODC date filter.", "Consistency", "High", weekShort));
        if (badRigOn > 0)    wmrIssues.Add(Issue("actual_rig_on_date",        $"{badRigOn} rows have an unparseable actual_rig_on_date — ODC category logic (DNC, Due, Backlog) breaks for these wells", "Validity", "High", badRigOn));
        if (badRigOff > 0)   wmrIssues.Add(Issue("actual_rig_off_date",       $"{badRigOff} rows have an unparseable actual_rig_off_date — 'Drilled Not Completed' and 'Ready for Commissioning' detection fails", "Validity", "High", badRigOff));
        if (badCommPct > 0)  wmrIssues.Add(Issue("overall_comm_progress_100", $"{badCommPct} rows have commissioning progress outside 0–1 — Hook-Up category may misfire", "Validity", "Medium", badCommPct));
        if (dupWellWeek > 0) wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — same well may land in two ODC categories depending on which row is selected by ROW_NUMBER()", "Integrity", "High", dupWellWeek));
        if (days > 7)        wmrIssues.Add(Issue("Week_Number", $"Latest snapshot is {days} days old ({latestWeek}) — ODC category counts may be stale", "Freshness", days > 14 ? "High" : "Medium", days));
        wmrIssues.AddRange(wmrStructIssuesO);

        // ── TaskPlan table ────────────────────────────────────────────────────
        var tpTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)", ct);
        var tpNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK) WHERE [New_Well_ID] IS NULL OR [New_Well_ID]=''", ct);
        var tpNullAction = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK) WHERE [Resume_Suspend] IS NULL", ct);
        var tpBadAction  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK) WHERE [Resume_Suspend] NOT IN ('Suspend','Resume')", ct);
        var tpNullStart  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK) WHERE TRY_CAST(actual_start AS DATE) IS NULL", ct);
        var tpOrphan     = await Count(conn,
            "SELECT COUNT(DISTINCT t.[New_Well_ID]) FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK) " +
            "WHERE t.[New_Well_ID] IS NOT NULL AND t.[New_Well_ID]<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=t.[New_Well_ID])", ct);

        var tpSamples = await Rows(conn,
            "SELECT TOP 5 [New_Well_ID],[Resume_Suspend],actual_start FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK) " +
            "WHERE [New_Well_ID] IS NULL OR [Resume_Suspend] IS NULL OR TRY_CAST(actual_start AS DATE) IS NULL", 5, ct);

        var (tpStructPenaltyO, tpStructIssuesO) = await StructuralIntegrity(conn, "WMR_TaskPlan_csv_imported", tpTotal, "New_Well_ID", "WMR.pdo_well_id", ct);
        double tpComplete = Rate(tpNullWellId + tpNullAction + tpNullStart, tpTotal * 3);
        double tpValid    = Rate(tpBadAction, tpTotal);
        double tpInteg    = Rate(tpOrphan + tpStructPenaltyO, Math.Max(tpTotal, 1));
        double tpScore    = NaScore(tpTotal, ApplyGate(WeightedScore(tpComplete, tpValid, 1.0, tpInteg, 1.0), tpComplete, tpInteg));

        var tpIssues = new List<object>();
        if (tpNullWellId > 0) tpIssues.Add(Issue("New_Well_ID",    $"{tpNullWellId} rows have NULL/empty New_Well_ID — those suspension records are ignored; some active wells may appear as 'active' when they are actually suspended", "Completeness", "High", tpNullWellId));
        if (tpNullAction > 0) tpIssues.Add(Issue("Resume_Suspend", $"{tpNullAction} rows have NULL action — excluded from latest-action check, suspension status undetermined", "Completeness", "High", tpNullAction, tpSamples));
        if (tpNullStart > 0)  tpIssues.Add(Issue("actual_start",   $"{tpNullStart} rows have unparseable actual_start — ROW_NUMBER ordering by date fails, latest suspension action may be wrong", "Validity", "Medium", tpNullStart));
        if (tpBadAction > 0)  tpIssues.Add(Issue("Resume_Suspend", $"{tpBadAction} rows have values other than 'Suspend'/'Resume' — those rows are filtered out silently", "Validity", "Medium", tpBadAction));
        if (tpOrphan > 0)     tpIssues.Add(Issue("New_Well_ID",    $"{tpOrphan} distinct New_Well_IDs have no matching WMR.pdo_well_id — orphan suspension records that can never affect any well's status", "Integrity", "Medium", tpOrphan));
        tpIssues.AddRange(tpStructIssuesO);

        double overall = wmrScore * 0.60 + tpScore * 0.40;

        return BuildResponse("odcStatus",
            "ODC Overall Status chart. Sources: dbo.WMR (weekly snapshots) + dbo.WMR_TaskPlan_csv_imported (Suspend/Resume actions).",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                       totalRows = wmrTotal, reliabilityScore = wmrScore, reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.WMR_TaskPlan_csv_imported", totalRows = tpTotal,  reliabilityScore = tpScore,  reliabilityLabel = Label(tpScore),  issues = tpIssues }
            });
    }

    // =========================================================================
    // 4. DRILLED WELLS — dbo.WMR (actual_rig_off_date)
    // =========================================================================
    private async Task<object> QualityDrilledWells(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness: rig_off_date is the gate for "drilled"
        var nullRigOff    = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND actual_rig_off_date IS NULL", ct);

        // Validity
        var badRigOff     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE actual_rig_off_date IS NOT NULL AND TRY_CAST(actual_rig_off_date AS DATE) IS NULL", ct);

        // Consistency: rig_off before rig_on
        var rigOffBeforeOn = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE TRY_CAST(actual_rig_off_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(actual_rig_on_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(actual_rig_off_date AS DATE) < TRY_CAST(actual_rig_on_date AS DATE)", ct);

        // Integrity
        var dupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness: latest rig_off date
        var latestRigOff = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(TRY_CAST(actual_rig_off_date AS DATE))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSinceRigOff = latestRigOff is not null && DateOnly.TryParse(latestRigOff, out var lr)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lr.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSinceRigOff, 14, 46);

        var samples = await Rows(conn,
            "SELECT TOP 5 pdo_well_id,actual_rig_on_date,actual_rig_off_date,over_all_progress_percentages " +
            "FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE TRY_CAST(actual_rig_off_date AS DATE) IS NOT NULL AND TRY_CAST(actual_rig_on_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(actual_rig_off_date AS DATE) < TRY_CAST(actual_rig_on_date AS DATE)", 5, ct);

        var (wmrStructPenaltyDr, wmrStructIssuesDr) = await StructuralIntegrity(conn, "WMR", wmrTotal, null, null, ct);
        double completeness = Rate(nullRigOff, distinctWells);
        double validity     = Rate(badRigOff, wmrTotal);
        double consistency  = Rate(rigOffBeforeOn, wmrTotal);
        double integrity    = Rate(dupWellWeek + wmrStructPenaltyDr, wmrTotal);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullRigOff > 0)      wmrIssues.Add(Issue("actual_rig_off_date", $"{nullRigOff} distinct wells have no actual_rig_off_date — those wells are excluded from the Drilled Wells count entirely", "Completeness", "High", nullRigOff));
        if (badRigOff > 0)       wmrIssues.Add(Issue("actual_rig_off_date", $"{badRigOff} rows have an unparseable actual_rig_off_date — TRY_CAST returns NULL, those wells are also excluded", "Validity", "High", badRigOff));
        if (rigOffBeforeOn > 0)  wmrIssues.Add(Issue("actual_rig_off_date / actual_rig_on_date", $"{rigOffBeforeOn} rows where rig_off_date < rig_on_date — physically impossible; data-entry error", "Consistency", "High", rigOffBeforeOn, samples));
        if (dupWellWeek > 0)     wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — snapshot ROW_NUMBER may pick a row with a different rig_off_date", "Integrity", "Medium", dupWellWeek));
        if (daysSinceRigOff > 14)wmrIssues.Add(Issue("actual_rig_off_date", $"Latest recorded rig_off_date is {daysSinceRigOff} days ago ({latestRigOff}) — drilled well count may be understated if recent completions are not yet entered", "Freshness", daysSinceRigOff > 30 ? "High" : "Medium", daysSinceRigOff));
        wmrIssues.AddRange(wmrStructIssuesDr);

        return BuildResponse("drilledWells",
            "Drilled Wells completion widget. Source: dbo.WMR filtered by actual_rig_off_date.",
            wmrScore,
            new List<object> { new { table = "dbo.WMR", totalRows = wmrTotal, reliabilityScore = wmrScore, reliabilityLabel = Label(wmrScore), issues = wmrIssues } });
    }

    // =========================================================================
    // 5. DUE WELLS — dbo.WMR (actual_rig_on_date + Week_Number)
    // =========================================================================
    // =========================================================================
    // 5. DUE WELLS KPI TILE (dashboard) — dbo.WMR
    //    Counts: wells where SAP expected_rig_on_date < toDate AND progress > 0
    //    Used for the "Due Wells 11" chip on the TOTAL WELLS / COMPLETED WELLS tiles.
    // =========================================================================
    private async Task<object> QualityDueWells(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness — SAP expected rig-on date drives the Due gate
        var nullSapRigOn = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);
        // Active wells missing SAP date → forced Non-Due
        var activeNoSap = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT),0) > 0 " +
            "AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);

        // Validity — bad SAP date format
        var badSapRigOn = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE [latest_exp.rig_on_location_sap_data] IS NOT NULL " +
            "AND LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))<>'' " +
            "AND TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE) IS NULL", ct);

        // Consistency — mixed Week_Number format (YYYY-MM-DD vs YY-MM-DD)
        var weekShort = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);

        // Integrity — duplicate snapshots
        var dupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);

        var (wmrStructPenaltyDu, wmrStructIssuesDu) = await StructuralIntegrity(conn, "WMR", wmrTotal, null, null, ct);
        double completeness = Rate(nullSapRigOn, distinctWells);
        double validity     = Rate(badSapRigOn, wmrTotal);
        double consistency  = weekShort > 0 && weekLong > 0 ? Rate(Math.Min(weekShort, weekLong), wmrTotal) : 1.0;
        double integrity    = Rate(dupWellWeek + wmrStructPenaltyDu, wmrTotal);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullSapRigOn > 0)          wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{nullSapRigOn} distinct wells have no SAP expected rig-on date — the Due gate (SAP date < toDate) cannot fire; those wells are always Non-Due regardless of progress.", "Completeness", "High", nullSapRigOn));
        if (activeNoSap > 0)           wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{activeNoSap} active wells (progress>0) have no SAP date — they are silently classified as Non-Due, understating the Due Wells chip.", "Completeness", "Medium", activeNoSap));
        if (badSapRigOn > 0)           wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{badSapRigOn} rows have a non-null SAP date that TRY_CAST cannot parse as DATE — those wells fall through the Due gate.", "Validity", "High", badSapRigOn));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed formats: {weekShort} rows YY-MM-DD (8-char), {weekLong} rows YYYY-MM-DD. The COALESCE(TRY_CONVERT(DATE,col,23), TRY_CONVERT(DATE,'20'+col,23)) fix handles both — without it the 8-char rows drop out of the latest-snapshot CTE.", "Consistency", "High", weekShort));
        if (dupWellWeek > 0)           wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — ROW_NUMBER() arbitrarily picks one; which row wins determines Due vs Non-Due classification.", "Integrity", "High", dupWellWeek));
        if (days > 7)                  wmrIssues.Add(Issue("Week_Number", $"Latest WMR snapshot is {days} days old ({latestWeek}) — Due Wells count may not reflect wells completed since then.", "Freshness", days > 14 ? "High" : "Medium", days));
        wmrIssues.AddRange(wmrStructIssuesDu);

        return BuildResponse("dueWells",
            "Due Wells KPI chip (dashboard). Source: dbo.WMR — wells where [latest_exp.rig_on_location_sap_data] < toDate AND progress > 0. " +
            "Drives the 'Due Wells' and 'Non Due Wells' chips on the COMPLETED WELLS tile.",
            Math.Round(wmrScore, 1),
            new List<object> { new { table = "dbo.WMR", totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues } });
    }

    // =========================================================================
    // 5a. DUE WELLS COMPLETION WIDGET — dbo.WMR + dbo.TaskPlanCSVImport
    //     "Well Delivery Completion Overview YTD 2026" section.
    //     KPI tiles: Total Due Wells, Completed, In Progress, Suspended, Completion Rate.
    //     Filter: Week_Number BETWEEN ytdFrom AND today, SAP expected_rig_on_date < toDate, progress > 0.
    // =========================================================================
    private async Task<object> QualityDueWellsCompletion(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);
        var ytdFrom       = $"{DateTime.Today.Year}-01-01";
        var todayStr      = DateTime.Today.ToString("yyyy-MM-dd");

        // Completeness — SAP expected rig-on date is the primary Due gate
        var nullSapRigOn = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);
        // How many of the due-window wells (progress>0) have no SAP date
        var dueWindowNoSap = await Count(conn,
            $"SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            $"WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            $"AND COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)) BETWEEN '{ytdFrom}' AND '{todayStr}' " +
            $"AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT),0) > 0 " +
            $"AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);

        // Validity — bad SAP date format (will be silently excluded from DueWells CTE)
        var badSapDate = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE [latest_exp.rig_on_location_sap_data] IS NOT NULL " +
            "AND LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))<>'' " +
            "AND TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE) IS NULL", ct);
        // Bad progress values — affects Completed / In Progress split
        var badProgress = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "AND over_all_progress_percentages IS NOT NULL " +
            "AND TRY_CAST(over_all_progress_percentages AS FLOAT) NOT BETWEEN 0 AND 1", ct);

        // Consistency — mixed Week_Number format causes wells to drop out of the YTD date filter
        var weekShort = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        // comm_finish / comm_start used for Breakdown (Commissioned vs Backlog-in-comm)
        var badCommFinish = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL " +
            "AND TRY_CAST([actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) IS NULL", ct);

        // Integrity — duplicate snapshots affect which progress value wins for Completed/InProgress split
        var dupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);

        var (wmrStructPenaltyDC, wmrStructIssuesDC) = await StructuralIntegrity(conn, "WMR", wmrTotal, null, null, ct);
        double completeness = Rate(nullSapRigOn + dueWindowNoSap, distinctWells * 2);
        double validity     = Rate(badSapDate + badProgress, wmrTotal * 2);
        double consistency  = weekShort > 0 && weekLong > 0 ? Rate(Math.Min(weekShort, weekLong), wmrTotal) : 1.0;
        double integrity    = Rate(dupWellWeek + wmrStructPenaltyDC, wmrTotal);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullSapRigOn > 0)      wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{nullSapRigOn} distinct wells have no SAP expected rig-on date — the DueWells CTE gate (SAP date IS NOT NULL AND < toDate) silently excludes them from Total Due Wells count.", "Completeness", "High", nullSapRigOn));
        if (dueWindowNoSap > 0)   wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{dueWindowNoSap} active wells inside the YTD window have no SAP date — they are invisible to Completed/InProgress/Suspended tiles.", "Completeness", "Medium", dueWindowNoSap));
        if (badSapDate > 0)        wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{badSapDate} rows have a non-null SAP date that fails TRY_CAST — those wells are silently dropped from Total Due Wells.", "Validity", "High", badSapDate));
        if (badProgress > 0)       wmrIssues.Add(Issue("over_all_progress_percentages", $"{badProgress} rows have progress outside 0–1 — Completed (>=1.0) vs In Progress (<1.0) split is unreliable for these wells.", "Validity", "Medium", badProgress));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed formats coexist: {weekShort} rows YY-MM-DD (8-char) and {weekLong} rows YYYY-MM-DD. The COALESCE fix handles both; without it the 8-char rows are excluded from the YTD Week_Number BETWEEN filter, understating all completion tile counts.", "Consistency", "High", weekShort));
        if (badCommFinish > 0)     wmrIssues.Add(Issue("actual_comm._finish_date", $"{badCommFinish} rows have a non-null comm_finish date that cannot be parsed — those wells are misclassified in the Commissioned vs Backlog-in-Comm breakdown.", "Consistency", "Medium", badCommFinish));
        if (dupWellWeek > 0)       wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — the ROW_NUMBER() tie-break determines which progress value is used for the Completed / In Progress split.", "Integrity", "High", dupWellWeek));
        if (days > 7)              wmrIssues.Add(Issue("Week_Number", $"Latest WMR snapshot is {days} days old ({latestWeek}) — Completion Rate and tile counts are stale.", "Freshness", days > 14 ? "High" : "Medium", days));

        // ── dbo.TaskPlanCSVImport — drives the Suspended count ───────────────
        long tpTotal, tpNullWellId, tpNullAction, tpBadAction, tpNullTs, tpOrphan;
        try
        {
            tpTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK)", ct);
            tpNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK) WHERE [Well_ID] IS NULL OR [Well_ID]=''", ct);
            tpNullAction = await Count(conn, "SELECT COUNT(*) FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK) WHERE [Resume_Suspend] IS NULL", ct);
            tpBadAction  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK) WHERE [Resume_Suspend] NOT IN ('Suspend','Resume')", ct);
            tpNullTs     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK) WHERE [time_stamp] IS NULL", ct);
            tpOrphan     = await Count(conn,
                "SELECT COUNT(DISTINCT t.[Well_ID]) FROM [dbo].[TaskPlanCSVImport] t WITH (NOLOCK) " +
                "WHERE t.[Well_ID] IS NOT NULL AND t.[Well_ID]<>'' " +
                "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=t.[Well_ID])", ct);
        }
        catch
        {
            // Table may not exist in all environments
            tpTotal = tpNullWellId = tpNullAction = tpBadAction = tpNullTs = tpOrphan = -1;
        }

        var tpIssues = new List<object>();
        var tpStructPenaltyDC = 0L;
        var tpStructIssuesDC  = new List<object>();

        if (tpTotal >= 0)
        {
            // NOTE: The Suspended count uses Resume_Suspend = 'Suspend' with NO latest-action
            // deduplication (any Suspend row counts). Wells that were suspended then resumed
            // can still appear as Suspended if the Suspend row is present.
            tpIssues.Add(Issue("Resume_Suspend",
                "The Suspended count queries TaskPlanCSVImport for Resume_Suspend='Suspend' without checking whether the LATEST action for that well is Suspend. A well that was Suspended then Resumed still counts as Suspended if a Suspend row exists.",
                "Consistency", "High", tpTotal > 0 ? tpTotal : 0));
            if (tpNullWellId > 0) tpIssues.Add(Issue("Well_ID", $"{tpNullWellId} rows have NULL/empty Well_ID — those Suspend/Resume actions can never be joined to WMR wells.", "Completeness", "High", tpNullWellId));
            if (tpNullAction > 0) tpIssues.Add(Issue("Resume_Suspend", $"{tpNullAction} rows have NULL Resume_Suspend — those rows are filtered out of the Suspended count query.", "Completeness", "Medium", tpNullAction));
            if (tpBadAction > 0)  tpIssues.Add(Issue("Resume_Suspend", $"{tpBadAction} rows have values other than 'Suspend'/'Resume' — unexpected values are silently ignored.", "Validity", "Medium", tpBadAction));
            if (tpNullTs > 0)     tpIssues.Add(Issue("time_stamp", $"{tpNullTs} rows have NULL time_stamp — ordering by time_stamp to find the latest action per well is unreliable.", "Validity", "High", tpNullTs));
            if (tpOrphan > 0)     tpIssues.Add(Issue("Well_ID", $"{tpOrphan} TaskPlan wells have no matching pdo_well_id in WMR — those Suspend/Resume rows are wasted; their wells do not appear in any completion tile.", "Integrity", "Medium", tpOrphan));
        }
        else
        {
            tpTotal  = 0;
            tpIssues.Add(Issue("table", "dbo.TaskPlanCSVImport could not be queried — Suspended count will always be 0.", "Completeness", "High", 0));
        }

        if (tpTotal >= 0)
        {
            (tpStructPenaltyDC, tpStructIssuesDC) = await StructuralIntegrity(conn, "TaskPlanCSVImport", Math.Max(tpTotal, 0), "Well_ID", "WMR.pdo_well_id", ct);
            tpIssues.AddRange(tpStructIssuesDC);
        }
        double tpComplete = tpTotal > 0 ? Rate(tpNullWellId + tpNullAction, tpTotal * 2) : 0.5;
        double tpValid    = tpTotal > 0 ? Rate(tpBadAction + tpNullTs, tpTotal * 2)      : 0.5;
        // Consistency penalty: the no-latest-action issue is structural (always present)
        double tpConsist  = tpTotal > 0 ? 0.60 : 0.50;
        double tpInteg    = tpTotal > 0 ? Rate(tpOrphan + tpStructPenaltyDC, Math.Max(distinctWells, 1)) : 0.5;
        double tpScore    = NaScore(tpTotal >= 0 ? tpTotal : 0, ApplyGate(WeightedScore(tpComplete, tpValid, tpConsist, tpInteg, 1.0), tpComplete, tpInteg));

        double overall = Math.Round(wmrScore * 0.70 + tpScore * 0.30, 1);

        return BuildResponse("dueWellsCompletion",
            "Well Delivery Completion Overview YTD 2026 — KPI tiles (Total Due Wells, Completed, In Progress, Suspended, Completion Rate). " +
            "Sources: dbo.WMR (Week_Number YTD range, SAP expected_rig_on_date gate, progress split) + dbo.TaskPlanCSVImport (Suspended count).",
            overall,
            new List<object>
            {
                new { table = "dbo.WMR",              totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.TaskPlanCSVImport", totalRows = (long)tpTotal, reliabilityScore = Math.Round(tpScore, 1), reliabilityLabel = Label(tpScore), issues = tpIssues }
            });
    }

    // =========================================================================
    // 5b. DUE WELLS COMPLETION TREND CHART — dbo.WMR
    //     "Due Wells Completion Trend" chart (Area/Bar, monthly, YTD).
    //     Query: same DueWells CTE as 5a, grouped by FORMAT(sap_rig_on_date,'yyyy-MM').
    //     Chart % = SUM(month_completed) / SUM(month_total) per cumulative month.
    //     The 49% badge is cumulative completion rate across all due months YTD.
    // =========================================================================
    private async Task<object> QualityDueWellsCompletionTrend(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var ytdFrom       = $"{DateTime.Today.Year}-01-01";
        var todayStr      = DateTime.Today.ToString("yyyy-MM-dd");

        // Completeness — SAP date must be parseable and non-null for the GROUP BY month to fire
        var nullSapRigOn = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            "AND ([latest_exp.rig_on_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))='')", ct);
        // Wells in YTD window with progress>0 but no parseable SAP date → invisible on chart
        var dueWindowNoSap = await Count(conn,
            $"SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            $"WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' " +
            $"AND COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)) BETWEEN '{ytdFrom}' AND '{todayStr}' " +
            $"AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT),0) > 0 " +
            $"AND TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE) IS NULL", ct);

        // Validity — bad SAP date causes the entire row to be excluded from the trend groups
        var badSapDate = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE [latest_exp.rig_on_location_sap_data] IS NOT NULL " +
            "AND LTRIM(RTRIM(CAST([latest_exp.rig_on_location_sap_data] AS NVARCHAR(50))))<>'' " +
            "AND TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE) IS NULL", ct);

        // Consistency — Week_Number mixed format: 8-char rows silently excluded from YTD filter
        var weekShort = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        // SAP date distribution — months with very few records inflate/deflate the chart line
        var sapMonths = await Count(conn,
            $"SELECT COUNT(DISTINCT FORMAT(TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE),'yyyy-MM')) " +
            $"FROM [dbo].[WMR] WITH (NOLOCK) " +
            $"WHERE TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE) BETWEEN '{ytdFrom}' AND '{todayStr}' " +
            $"AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT),0) > 0", ct);

        // Integrity — duplicate snapshots can double-count a well in a month's total/completed
        var dupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);
        // No data in YTD window is a hard freshness failure
        if (sapMonths == 0) freshnessRate = Math.Min(freshnessRate, 0.30);

        var distinctWells2 = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);
        var (wmrStructPenaltyDT, wmrStructIssuesDT) = await StructuralIntegrity(conn, "WMR", wmrTotal, null, null, ct);
        double completeness = Rate(nullSapRigOn + dueWindowNoSap, distinctWells2 * 2);
        double validity     = Rate(badSapDate, wmrTotal);
        double consistency  = weekShort > 0 && weekLong > 0 ? Rate(Math.Min(weekShort, weekLong), wmrTotal) : 1.0;
        double integrity    = Rate(dupWellWeek + wmrStructPenaltyDT, wmrTotal);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullSapRigOn > 0)     wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{nullSapRigOn} distinct wells have no SAP expected rig-on date — they are invisible in every month-band of the trend chart because the GROUP BY is on FORMAT(sap_rig_on_date,'yyyy-MM').", "Completeness", "High", nullSapRigOn));
        if (dueWindowNoSap > 0)  wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{dueWindowNoSap} active wells in the YTD window have no parseable SAP date — those completions are missing from the trend line, causing the cumulative % badge to be understated.", "Completeness", "Medium", dueWindowNoSap));
        if (badSapDate > 0)       wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"{badSapDate} rows have a non-null SAP date that TRY_CAST cannot parse as DATE — those rows produce NULL in the GROUP BY and are excluded from all chart months.", "Validity", "High", badSapDate));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed formats: {weekShort} rows YY-MM-DD (8-char), {weekLong} rows YYYY-MM-DD. Without the COALESCE fix, 8-char rows drop out of the YTD BETWEEN filter — entire wells disappear from the chart.", "Consistency", "High", weekShort));
        if (dupWellWeek > 0)      wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — a well can be double-counted in a month's total and completed column, skewing the month % bar.", "Integrity", "High", dupWellWeek));
        if (sapMonths == 0)       wmrIssues.Add(Issue("[latest_exp.rig_on_location_sap_data]", $"No parseable SAP rig-on dates fall within {ytdFrom}–{todayStr}. The chart will be empty — all due-well records either have future dates, NULL dates, or unparseable formats.", "Freshness", "High", 0));
        else if (days > 7)        wmrIssues.Add(Issue("Week_Number", $"Latest WMR snapshot is {days} days old ({latestWeek}) — the trend chart's rightmost data point and cumulative % are stale by at least {days} days.", "Freshness", days > 14 ? "High" : "Medium", days));
        wmrIssues.AddRange(wmrStructIssuesDT);

        return BuildResponse("dueWellsCompletionTrend",
            "Due Wells Completion Trend chart (Area/Bar, monthly YTD). " +
            "Source: dbo.WMR — same DueWells CTE as the completion widget, " +
            "grouped by FORMAT([latest_exp.rig_on_location_sap_data],'yyyy-MM'). " +
            "Chart % per month = completed / total for that SAP-rig-on month. " +
            "Badge % (49%) = cumulative completion rate across all due months YTD.",
            Math.Round(wmrScore, 1),
            new List<object> { new { table = "dbo.WMR", totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues } });
    }

    // =========================================================================
    // 6. PENALTY EXPOSURE — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History
    //    Penalty = Critical wells (variance < 0) driven by actual vs planned progress.
    //    Planned % is computed from SAP plan start/end dates — NOT a WMR column.
    // =========================================================================
    private async Task<object> QualityPenaltyExposure(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness: progress NULL → can't compute variance → well never flagged Critical
        var nullProgress  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NULL AND pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Validity: progress > 1 → variance sign unreliable
        var progressOver1 = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE TRY_CAST(over_all_progress_percentages AS FLOAT) > 1", ct);

        // Consistency: dual Week_Number format (snapshot selection affected)
        var weekShort = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);

        // Integrity: duplicates → arbitrary snapshot row → wrong progress value for variance
        var dupWellWeek  = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        // Wells under >1 project_id → same critical well counted in multiple clusters → double-penalty
        var multiProject = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);

        var sampleDups = await Rows(conn,
            "SELECT TOP 5 pdo_well_id,Week_Number,COUNT(*) AS row_count FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC", 5, ct);
        var sampleMulti = await Rows(conn,
            "SELECT TOP 5 pdo_well_id,COUNT(DISTINCT project_id) AS project_count FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1", 5, ct);

        double completeness = Rate(nullProgress, wmrTotal);
        double validity     = Rate(progressOver1, wmrTotal);
        double consistency  = weekShort > 0 && weekLong > 0 ? Rate(Math.Min(weekShort, weekLong), wmrTotal) : 1.0;
        double integrity    = Rate(dupWellWeek + multiProject, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullProgress > 0)          wmrIssues.Add(Issue("over_all_progress_percentages", $"{nullProgress} rows have NULL actual progress — variance cannot be computed; well is never identified as Critical/penalty risk", "Completeness", "High", nullProgress));
        if (progressOver1 > 0)         wmrIssues.Add(Issue("over_all_progress_percentages", $"{progressOver1} rows have progress > 100% — variance sign is unreliable for these wells; they may appear 'ahead' when they are actually behind", "Validity", "Medium", progressOver1));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed date formats: {weekShort} rows use YY-MM-DD, {weekLong} use YYYY-MM-DD. Rows excluded from the snapshot date filter are omitted from variance computation, understating penalty exposure.", "Consistency", "High", weekShort));
        if (dupWellWeek > 0)           wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs. ROW_NUMBER picks one row arbitrarily — the chosen row's progress determines whether a well is Critical (penalty risk) or not.", "Integrity", "High", dupWellWeek, sampleDups));
        if (multiProject > 0)          wmrIssues.Add(Issue("pdo_well_id / project_id", $"{multiProject} wells appear under more than one project_id — the same critical well is counted separately in each cluster it appears in, inflating total penalty exposure.", "Integrity", "High", multiProject, sampleMulti));
        if (days > 7)                  wmrIssues.Add(Issue("Week_Number", $"Latest snapshot is {days} days old ({latestWeek}) — penalty exposure may not reflect current well progress", "Freshness", days > 14 ? "High" : "Medium", days));

        // ── SAP table (provides planned baseline for variance) ───────────────
        var sapTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapBadStart   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var sapBadEnd     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE TRY_CAST(EarliestEndDate AS DATE) IS NULL", ct);
        var sapEndBefore  = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE TRY_CAST(EarliestEndDate AS DATE) IS NOT NULL AND TRY_CAST(Earl_start_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(EarliestEndDate AS DATE) < TRY_CAST(Earl_start_date AS DATE)", ct);
        // Active wells with no SAP record → variance is NULL → never marked Critical
        var noSapActive   = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND TRY_CAST(w.over_all_progress_percentages AS FLOAT) > 0 AND TRY_CAST(w.over_all_progress_percentages AS FLOAT) < 1.0 " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        var sapSamples = await Rows(conn,
            "SELECT TOP 5 Well_ID,Earl_start_date,EarliestEndDate FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE TRY_CAST(EarliestEndDate AS DATE) IS NOT NULL AND TRY_CAST(Earl_start_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(EarliestEndDate AS DATE) < TRY_CAST(Earl_start_date AS DATE)", 5, ct);

        double sapComplete = Rate(sapNullWellId + sapBadStart + sapBadEnd, sapTotal * 3);
        double sapConsist  = Rate(sapEndBefore, sapTotal);
        double sapInteg    = Rate(noSapActive, Math.Max(distinctWells, 1));
        double sapScore    = NaScore(sapTotal, ApplyGate(WeightedScore(sapComplete, 1.0, sapConsist, sapInteg, 1.0), sapComplete, sapInteg));

        var sapIssues = new List<object>();
        if (noSapActive > 0) sapIssues.Add(Issue("(structural)", $"{noSapActive} active WMR wells have no SAP record — planned progress % cannot be computed; those wells always have NULL variance and can never be flagged Critical.", "Integrity", "High", noSapActive));
        if (sapNullWellId > 0)  sapIssues.Add(Issue("Well_ID",          $"{sapNullWellId} SAP rows with NULL Well_ID — cannot join to WMR.pdo_well_id; planned baseline unavailable", "Completeness", "High", sapNullWellId));
        if (sapBadStart > 0)    sapIssues.Add(Issue("Earl_start_date",   $"{sapBadStart} rows with unparseable plan start date — planned % cannot be computed", "Validity", "Medium", sapBadStart));
        if (sapBadEnd > 0)      sapIssues.Add(Issue("EarliestEndDate",   $"{sapBadEnd} rows with unparseable plan end date", "Validity", "Medium", sapBadEnd));
        if (sapEndBefore > 0)   sapIssues.Add(Issue("Earl_start_date / EarliestEndDate", $"{sapEndBefore} rows where plan end < plan start — negative duration produces nonsense variance", "Consistency", "High", sapEndBefore, sapSamples));

        double overall = wmrScore * 0.65 + sapScore * 0.35;

        return BuildResponse("penaltyExposure",
            "Exec Summary — Penalty Exposure tile (Critical + AtRisk wells). Variance = actual progress − planned % (derived from SAP dates). Sources: dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal,  reliabilityScore = wmrScore, reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal,  reliabilityScore = sapScore, reliabilityLabel = Label(sapScore), issues = sapIssues }
            });
    }

    // =========================================================================
    // 7. BONUS POTENTIAL — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History
    //    Bonus = wells with positive variance (ahead of SAP plan schedule).
    // =========================================================================
    private async Task<object> QualityBonusPotential(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness: NULL progress → variance NULL → well never shows bonus potential
        var nullProgress  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NULL AND pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Validity: progress > 1 → artificial positive variance → inflated bonus count
        var progressOver1 = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE TRY_CAST(over_all_progress_percentages AS FLOAT) > 1", ct);

        // Consistency: dual Week_Number format
        var weekShort = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        // Consistency: buffer_status = 'Critical' but progress ahead of plan (status vs variance contradiction)
        // Note: we check this purely on progress > 0.85 as a proxy since planned% requires SAP join
        var statusContradiction = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE buffer_status='Critical' AND TRY_CAST(over_all_progress_percentages AS FLOAT) > 0.85 " +
            "AND pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Integrity: duplicate rows + multi-project wells
        var dupWellWeek  = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        var multiProject = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);

        // Freshness
        var latestWeek = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);

        var sampleOver1 = await Rows(conn,
            "SELECT TOP 5 pdo_well_id,over_all_progress_percentages,Week_Number FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE TRY_CAST(over_all_progress_percentages AS FLOAT) > 1 AND pdo_well_id IS NOT NULL ORDER BY TRY_CAST(over_all_progress_percentages AS FLOAT) DESC", 5, ct);
        var sampleMulti = await Rows(conn,
            "SELECT TOP 5 pdo_well_id,COUNT(DISTINCT project_id) AS project_count FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1", 5, ct);

        double completeness = Rate(nullProgress, wmrTotal);
        double validity     = Rate(progressOver1, wmrTotal);
        double consistency  = Rate(
            (weekShort > 0 && weekLong > 0 ? Math.Min(weekShort, weekLong) : 0) + statusContradiction,
            wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + multiProject, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullProgress > 0)              wmrIssues.Add(Issue("over_all_progress_percentages", $"{nullProgress} rows have NULL actual progress — variance is NULL, those wells are invisible in the Bonus Potential count", "Completeness", "High", nullProgress));
        if (progressOver1 > 0)            wmrIssues.Add(Issue("over_all_progress_percentages", $"{progressOver1} rows have progress > 100% — they always produce positive variance, artificially inflating the Bonus Potential count", "Validity", "High", progressOver1, sampleOver1));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed date formats: {weekShort} rows use YY-MM-DD (8-char), {weekLong} use YYYY-MM-DD. Rows excluded from the snapshot date filter miss the variance check entirely, understating bonus potential.", "Consistency", "High", weekShort));
        if (statusContradiction > 0)       wmrIssues.Add(Issue("buffer_status / over_all_progress_percentages", $"{statusContradiction} wells have buffer_status='Critical' but progress > 85% — the status field and actual progress disagree; this may indicate stale status data or data-entry error.", "Consistency", "Medium", statusContradiction));
        if (dupWellWeek > 0)              wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs — ROW_NUMBER picks one row arbitrarily; an ahead-of-plan well could appear behind plan if the wrong row is chosen.", "Integrity", "High", dupWellWeek));
        if (multiProject > 0)             wmrIssues.Add(Issue("pdo_well_id / project_id", $"{multiProject} wells appear under more than one project_id — the same ahead-of-plan well is counted once per cluster it appears in, inflating the Bonus Potential count.", "Integrity", "High", multiProject, sampleMulti));
        if (days > 7)                     wmrIssues.Add(Issue("Week_Number", $"Latest snapshot is {days} days old ({latestWeek}) — bonus potential count may not reflect current progress", "Freshness", days > 14 ? "High" : "Medium", days));

        // SAP table (same reason as penalty: planned% is computed from SAP, not stored in WMR)
        var sapTotal    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var noSapActive = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND TRY_CAST(w.over_all_progress_percentages AS FLOAT) > 0 AND TRY_CAST(w.over_all_progress_percentages AS FLOAT) < 1.0 " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        double sapInteg = Rate(noSapActive, Math.Max(distinctWells, 1));
        double sapScore = NaScore(sapTotal, ApplyGate(WeightedScore(1.0, 1.0, 1.0, sapInteg, 1.0), 1.0, sapInteg));

        var sapIssues = new List<object>();
        if (noSapActive > 0) sapIssues.Add(Issue("(structural)", $"{noSapActive} active WMR wells have no SAP record — planned progress % cannot be computed; those wells cannot appear in Bonus Potential.", "Integrity", "High", noSapActive));

        double overall = wmrScore * 0.70 + sapScore * 0.30;

        return BuildResponse("bonusPotential",
            "Exec Summary — Bonus Potential tile (wells ahead of SAP plan schedule). Variance = actual progress − planned % (derived from SAP dates). Sources: dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal,  reliabilityScore = wmrScore, reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal,  reliabilityScore = sapScore, reliabilityLabel = Label(sapScore), issues = sapIssues }
            });
    }

    // =========================================================================
    // 8. GLOBAL FILTER DROPDOWNS — dbo.ProjectIDs + dbo.WMR
    //    Powers: Cluster / Site / Well Type / Project filter dropdowns.
    //    Source: GET /dashboard/cluster-wells — LEFT JOIN ProjectIDs → WMR.
    //    Cached 30 min. Any quality issue here silently removes wells from ALL
    //    downstream KPI tiles when the affected filter value is selected.
    // =========================================================================
    private async Task<object> QualityGlobalFilter(CancellationToken ct)
    {
        await using var conn = Open();

        // ── dbo.ProjectIDs ───────────────────────────────────────────────────
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);

        // Completeness: Cluster is the top-level grouping key — NULL → project invisible in dropdown
        var pidNullClust = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) " +
            "WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        // Site, Type, Project are the child filter values
        var pidNullSite  = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Site] IS NULL OR LTRIM(RTRIM([Site]))=''", ct);
        var pidNullType  = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Type] IS NULL OR LTRIM(RTRIM([Type]))=''", ct);
        var pidNullProj  = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Project] IS NULL OR LTRIM(RTRIM([Project]))=''", ct);
        var pidNullId    = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);

        // Validity: ID must be castable to NVARCHAR to join WMR.project_id
        var pidBadId     = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE TRY_CAST(ID AS NVARCHAR(100)) IS NULL", ct);

        // Consistency: cluster names must be unique after LTRIM/RTRIM (case-insensitive duplicates)
        var clusterDups  = await Count(conn,
            "SELECT COUNT(*) FROM (" +
            "  SELECT UPPER(LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))) AS c, COUNT(*) n " +
            "  FROM [dbo].[ProjectIDs] WITH (NOLOCK) " +
            "  WHERE [Cluster] IS NOT NULL GROUP BY UPPER(LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))) HAVING COUNT(*) > 1" +
            ") x", ct);

        // Integrity: WMR rows whose project_id has no ProjectIDs match
        //   → those wells are loaded into WMR but are invisible to ALL filter dropdowns
        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn,
            "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);
        var orphanWells   = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) " +
            "  WHERE CAST(p.ID AS NVARCHAR(100))=w.project_id)", ct);
        // ProjectIDs rows that have NO matching WMR well at all (empty cluster in dropdown)
        var emptyProjects = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] p WITH (NOLOCK) " +
            "WHERE NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "  WHERE w.project_id=CAST(p.ID AS NVARCHAR(100)) " +
            "  AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'')", ct);

        // Freshness: ProjectIDs is a configuration table — no date column; flag if WMR is stale
        var latestWeek   = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSinceWmr = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - lw.DayNumber : 999;
        // Freshness penalty: stale WMR means filter selections map to outdated well lists
        double freshnessRate = FreshnessRate(daysSinceWmr, 7, 28);

        // Sample orphan wells
        var sampleOrphans = await Rows(conn,
            "SELECT TOP 5 w.pdo_well_id, w.project_id, w.well_location " +
            "FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) " +
            "  WHERE CAST(p.ID AS NVARCHAR(100))=w.project_id) " +
            "GROUP BY w.pdo_well_id, w.project_id, w.well_location", 5, ct);
        var sampleEmptyProj = await Rows(conn,
            "SELECT TOP 5 p.ID, CAST(p.[Cluster] AS NVARCHAR(200)) AS Cluster, p.[Type], p.[Project] " +
            "FROM [dbo].[ProjectIDs] p WITH (NOLOCK) " +
            "WHERE NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "  WHERE w.project_id=CAST(p.ID AS NVARCHAR(100)) " +
            "  AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'')", 5, ct);

        // Scores — ProjectIDs
        double pidComplete  = Rate(pidNullClust + pidNullSite + pidNullType + pidNullProj + pidNullId, pidTotal * 5);
        double pidValid     = Rate(pidBadId, pidTotal);
        double pidConsist   = Rate(clusterDups, pidTotal);
        double pidInteg     = Rate(orphanWells + emptyProjects, distinctWells + pidTotal);
        double pidScore     = NaScore(pidTotal, ApplyGate(WeightedScore(pidComplete, pidValid, pidConsist, pidInteg, freshnessRate), pidComplete, pidInteg));

        var pidIssues = new List<object>();
        if (pidNullClust > 0)   pidIssues.Add(Issue("Cluster",  $"{pidNullClust} rows have NULL/empty Cluster — those projects are entirely invisible in the Cluster dropdown; all their wells are unreachable via any filter", "Completeness", "High",   pidNullClust));
        if (pidNullSite > 0)    pidIssues.Add(Issue("Site",     $"{pidNullSite} rows have NULL/empty Site — Site filter will not show those wells; users cannot filter down to them", "Completeness", "Medium", pidNullSite));
        if (pidNullType > 0)    pidIssues.Add(Issue("Type",     $"{pidNullType} rows have NULL/empty Well Type — Well Type filter will not show those wells", "Completeness", "Medium", pidNullType));
        if (pidNullProj > 0)    pidIssues.Add(Issue("Project",  $"{pidNullProj} rows have NULL/empty Project — Project filter will not list those projects", "Completeness", "Medium", pidNullProj));
        if (pidNullId > 0)      pidIssues.Add(Issue("ID",       $"{pidNullId} rows have NULL ID — cannot be matched to any WMR.project_id; entire project is invisible to all filters", "Completeness", "High",   pidNullId));
        if (pidBadId > 0)       pidIssues.Add(Issue("ID",       $"{pidBadId} rows have an ID value that cannot be CAST to NVARCHAR(100) — the join to WMR.project_id fails silently; all wells for those projects are hidden from filters", "Validity", "High", pidBadId));
        if (clusterDups > 0)    pidIssues.Add(Issue("Cluster",  $"{clusterDups} cluster names appear more than once after LTRIM/RTRIM/UPPER normalisation — the same cluster may appear as separate entries in the dropdown (e.g. 'NIMR ' vs 'NIMR')", "Consistency", "Medium", clusterDups));
        if (orphanWells > 0)    pidIssues.Add(Issue("ID ↔ WMR.project_id", $"{orphanWells} distinct WMR wells have a project_id that matches no ProjectIDs.ID (after CAST). Those wells exist in the DB but are permanently invisible when any Cluster/Site/Type/Project filter is applied — they only appear in the 'All' unfiltered view.", "Integrity", "High", orphanWells, sampleOrphans));
        if (emptyProjects > 0)  pidIssues.Add(Issue("ID ↔ WMR.project_id", $"{emptyProjects} ProjectIDs rows have no matching WMR wells. Those project entries appear in the dropdown but selecting them returns 0 wells — misleading to operators.", "Integrity", "Medium", emptyProjects, sampleEmptyProj));
        if (orphanWells > 0) pidIssues.Add(Issue("ID (join type)", $"{orphanWells} WMR wells have a project_id that matches no ProjectIDs.ID — no FK constraint enforces this join. Those wells are permanently invisible when any Cluster/Site/Type/Project filter is applied.", "Integrity", "High", orphanWells));
        if (daysSinceWmr > 7)   pidIssues.Add(Issue("WMR.Week_Number", $"WMR data is {daysSinceWmr} days old ({latestWeek}). Filter dropdowns resolve to the current well list in WMR — selecting a cluster/site may return stale wells that have since changed status.", "Freshness", daysSinceWmr > 14 ? "High" : "Medium", daysSinceWmr));

        // ── dbo.WMR (as the resolution target) ──────────────────────────────
        // WMR is the right side of the LEFT JOIN — its quality determines how many
        // wells actually appear when a filter value is selected.
        var wmrNullWellId = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var wmrNullProjId = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE project_id IS NULL OR project_id=''", ct);
        var wmrDupWell    = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        var wmrMultiProj  = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL " +
            "GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);

        double wmrComplete = Rate(wmrNullWellId + wmrNullProjId, wmrTotal * 2);
        double wmrInteg    = Rate(wmrDupWell + wmrMultiProj + orphanWells, wmrTotal + distinctWells);
        double wmrScore    = NaScore(wmrTotal, ApplyGate(WeightedScore(wmrComplete, 1.0, 1.0, wmrInteg, freshnessRate), wmrComplete, wmrInteg));

        var wmrIssues = new List<object>();
        if (wmrNullWellId > 0) wmrIssues.Add(Issue("pdo_well_id",  $"{wmrNullWellId} rows have NULL/empty pdo_well_id — those rows are excluded from the LEFT JOIN result; the wells are invisible when any filter is applied", "Completeness", "High",   wmrNullWellId));
        if (wmrNullProjId > 0) wmrIssues.Add(Issue("project_id",   $"{wmrNullProjId} rows have NULL/empty project_id — the join to ProjectIDs produces no match; wells cannot be assigned to any cluster/site/type/project filter value", "Completeness", "High",   wmrNullProjId));
        if (wmrMultiProj > 0)  wmrIssues.Add(Issue("project_id",   $"{wmrMultiProj} wells appear under more than one project_id — selecting a cluster filter returns that well multiple times (once per project it belongs to), inflating per-cluster counts", "Integrity",    "High",   wmrMultiProj));
        if (wmrDupWell > 0)    wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{wmrDupWell} duplicate (pdo_well_id, Week_Number) pairs — GROUP BY in the cluster-wells query deduplicates by (cluster, site, wellType, wellId), but duplicate WMR rows with different well_name_after_spud values may cause the well to appear more than once in the result", "Integrity", "Medium", wmrDupWell));
        if (orphanWells > 0)   wmrIssues.Add(Issue("project_id ↔ ProjectIDs.ID", $"{orphanWells} wells cannot be matched to any ProjectIDs row — selecting any specific cluster/site/type filter hides these wells entirely; they only appear in the global unfiltered view", "Integrity", "High", orphanWells, sampleOrphans));
        if (daysSinceWmr > 7)  wmrIssues.Add(Issue("Week_Number",  $"WMR snapshot is {daysSinceWmr} days old ({latestWeek}). Well lists returned when a filter is selected are {daysSinceWmr} days stale.", "Freshness", daysSinceWmr > 14 ? "High" : "Medium", daysSinceWmr));

        double overall = pidScore * 0.55 + wmrScore * 0.45;

        return BuildResponse("globalFilter",
            "Global filter dropdowns (Cluster / Site / Well Type / Project). " +
            "Source: GET /dashboard/cluster-wells — LEFT JOIN dbo.ProjectIDs (master registry) with dbo.WMR (weekly snapshots). " +
            "Cached 30 min. Any data quality issue here silently removes wells from ALL downstream KPI tiles when the affected filter value is selected.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.ProjectIDs", totalRows = pidTotal,  reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues },
                new { table = "dbo.WMR",        totalRows = wmrTotal,  reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues }
            });
    }

    // =========================================================================
    // 11. CREW P-RATING DISTRIBUTION
    //     Sources (exactly what CrewCacheLoader queries):
    //       dbo.task_daily          — base: crew_code, crew_type, ActionOn (last 90 days)
    //       dbo.PH_PRODUCTIVITY_WEEKLY_REPORT — enrichment: [Crew Type] join, [Month PI (CMR)] = P-Rating
    //       dbo.OLD_NEW_CREW_MAPPING.CREW_GROUP_CODE — deduplication key (crews whose code does
    //                                 not CONTAIN a group code are silently dropped from distribution)
    //       dbo.SAP_DRILLING_SEQUENCE_History — cluster (Field column) for filter support
    // =========================================================================
    private async Task<object> QualityCrewPRating(CancellationToken ct)
    {
        await using var conn = Open();
        var today     = DateOnly.FromDateTime(DateTime.UtcNow);
        var startDate = today.AddDays(-90).ToDateTime(TimeOnly.MinValue);
        var endDate   = today.AddDays(1).ToDateTime(TimeOnly.MinValue);

        // ── dbo.task_daily ────────────────────────────────────────────────────
        // The base query is: SELECT crew_code, crew_type, well_id, MAX(ActionOn), MAX(project_id)
        //   FROM dbo.task_daily WHERE ActionOn BETWEEN @start AND @end
        //   AND crew_code IS NOT NULL AND crew_code <> '' GROUP BY crew_code, crew_type, well_id

        var tdTotal = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[task_daily] WITH (NOLOCK) " +
            $"WHERE ActionOn >= '{startDate:yyyy-MM-dd}' AND ActionOn < '{endDate:yyyy-MM-dd}'", ct);

        // Completeness: crew_code NULL/empty — row excluded from base query entirely
        var tdNullCrewCode = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[task_daily] WITH (NOLOCK) " +
            $"WHERE ActionOn >= '{startDate:yyyy-MM-dd}' AND ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND (crew_code IS NULL OR crew_code = '')", ct);

        // Completeness: crew_type NULL/empty — JOIN to PH_PRODUCTIVITY_WEEKLY_REPORT fails;
        //   that crew gets no P-Rating and lands in Unrated
        var tdNullCrewType = await Count(conn,
            "SELECT COUNT(DISTINCT crew_code) FROM [dbo].[task_daily] WITH (NOLOCK) " +
            $"WHERE ActionOn >= '{startDate:yyyy-MM-dd}' AND ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND crew_code IS NOT NULL AND crew_code <> '' " +
            "AND (crew_type IS NULL OR crew_type = '')", ct);

        // Completeness: project_id NULL — crew cannot be cluster-filtered;
        //   invisible when any Cluster/Site/Type filter is applied
        var tdNullProjectId = await Count(conn,
            "SELECT COUNT(DISTINCT crew_code) FROM [dbo].[task_daily] WITH (NOLOCK) " +
            $"WHERE ActionOn >= '{startDate:yyyy-MM-dd}' AND ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND crew_code IS NOT NULL AND crew_code <> '' " +
            "AND (project_id IS NULL OR CAST(project_id AS NVARCHAR(100)) = '')", ct);

        // Integrity: distinct active crews in window
        var tdDistinctCrews = await Count(conn,
            "SELECT COUNT(DISTINCT crew_code) FROM [dbo].[task_daily] WITH (NOLOCK) " +
            $"WHERE ActionOn >= '{startDate:yyyy-MM-dd}' AND ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND crew_code IS NOT NULL AND crew_code <> ''", ct);

        // Freshness: most recent ActionOn in task_daily
        var latestAction = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12), MAX(ActionOn), 23) FROM [dbo].[task_daily] WITH (NOLOCK)", ct);
        int daysSince = latestAction is not null && DateOnly.TryParse(latestAction, out var la)
            ? today.DayNumber - la.DayNumber : 999;
        double freshnessTd = FreshnessRate(daysSince, 1, 6);

        var sampleNullCrewType = await Rows(conn,
            "SELECT TOP 5 crew_code, MAX(ActionOn) AS last_action " +
            "FROM [dbo].[task_daily] WITH (NOLOCK) " +
            $"WHERE ActionOn >= '{startDate:yyyy-MM-dd}' AND ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND crew_code IS NOT NULL AND crew_code <> '' " +
            "AND (crew_type IS NULL OR crew_type = '') " +
            "GROUP BY crew_code ORDER BY MAX(ActionOn) DESC", 5, ct);

        double tdComplete  = Rate(tdNullCrewCode + tdNullCrewType + tdNullProjectId, Math.Max(tdTotal, 1) + Math.Max(tdDistinctCrews, 1) * 2);
        double tdInteg     = Rate(tdNullProjectId, Math.Max(tdDistinctCrews, 1));
        double tdScore     = NaScore(tdTotal, ApplyGate(WeightedScore(tdComplete, 1.0, 1.0, tdInteg, freshnessTd), tdComplete, tdInteg));

        var tdIssues = new List<object>();
        if (tdNullCrewCode > 0)   tdIssues.Add(Issue("crew_code",  $"{tdNullCrewCode} rows in the last 90 days have NULL/empty crew_code — they are excluded from the base query and never appear in the P-Rating distribution", "Completeness", "High",   tdNullCrewCode));
        if (tdNullCrewType > 0)   tdIssues.Add(Issue("crew_type",  $"{tdNullCrewType} distinct crews have NULL/empty crew_type in the last 90 days. crew_type is the JOIN key to PH_PRODUCTIVITY_WEEKLY_REPORT.[Crew Type] — without it, no P-Rating can be assigned and those crews land in the Unrated bucket", "Completeness", "High",   tdNullCrewType, sampleNullCrewType));
        if (tdNullProjectId > 0)  tdIssues.Add(Issue("project_id", $"{tdNullProjectId} distinct crews have NULL/empty project_id — they are invisible when any Cluster / Site / Well Type filter is applied to the distribution chart", "Completeness", "Medium", tdNullProjectId));
        if (daysSince > 1)        tdIssues.Add(Issue("ActionOn",   $"Most recent task_daily record is {daysSince} days old ({latestAction}). The 90-day window shifts daily — stale data reduces the crew population in the distribution.", "Freshness", daysSince > 3 ? "High" : "Medium", daysSince));

        // ── dbo.PH_PRODUCTIVITY_WEEKLY_REPORT ─────────────────────────────────
        // JOIN: LEFT JOIN PH_PRODUCTIVITY_WEEKLY_REPORT cl ON cl.[Crew Type] = task_daily.crew_type AND cl.rn = 1
        //   where rn = ROW_NUMBER() OVER (PARTITION BY [Crew Type] ORDER BY ISNULL([Month PI (CMR)], 0) DESC)
        // So only the single row with the highest [Month PI (CMR)] per [Crew Type] is used.

        var phTotal = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK)", ct);

        // The enrichment join picks the single best row per [Crew Type]:
        //   ROW_NUMBER() OVER (PARTITION BY [Crew Type] ORDER BY ISNULL([Month PI (CMR)], 0) DESC) = 1
        // So only one PI value per Crew Type is ever used, regardless of how many rows exist.
        var phDistinctCrewTypes = await Count(conn,
            "SELECT COUNT(DISTINCT [Crew Type]) FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "WHERE [Crew Type] IS NOT NULL AND LTRIM(RTRIM([Crew Type])) <> ''", ct);

        // Completeness: [Crew Type] NULL — row can never be matched to task_daily.crew_type
        var phNullCrewType = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "WHERE [Crew Type] IS NULL OR LTRIM(RTRIM([Crew Type])) = ''", ct);

        // Completeness: [Month PI (CMR)] NULL — the JOIN result has no P-Rating; crew becomes Unrated
        //   The ROW_NUMBER ORDER BY uses ISNULL([Month PI (CMR)], 0) DESC, so nulls sort last —
        //   but if ALL rows for a Crew Type have NULL PI, the picked row still has NULL PI.
        var phNullPI = await Count(conn,
            "SELECT COUNT(DISTINCT [Crew Type]) FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "WHERE [Crew Type] IS NOT NULL AND LTRIM(RTRIM([Crew Type])) <> '' " +
            "AND ([Month PI (CMR)] IS NULL OR LTRIM(RTRIM(CAST([Month PI (CMR)] AS NVARCHAR(50)))) = '')", ct);

        // Validity: [Month PI (CMR)] cannot be parsed — the code does TRY_PARSE to double then
        //   prefix with 'P' if numeric, so non-numeric non-empty values produce pRating = raw string.
        //   If the raw string doesn't match 'P0'–'P8', it won't land in any P-band; crews end up Unrated.
        var phBadPI = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "WHERE [Month PI (CMR)] IS NOT NULL " +
            "AND LTRIM(RTRIM(CAST([Month PI (CMR)] AS NVARCHAR(50)))) <> '' " +
            "AND TRY_CAST([Month PI (CMR)] AS FLOAT) IS NULL " +
            "AND CAST([Month PI (CMR)] AS NVARCHAR(50)) NOT LIKE 'P[0-9]%'", ct);

        // Validity: PI value outside expected 0–8 integer range
        var phOutOfRange = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "WHERE TRY_CAST([Month PI (CMR)] AS FLOAT) IS NOT NULL " +
            "AND (TRY_CAST([Month PI (CMR)] AS FLOAT) < 0 OR TRY_CAST([Month PI (CMR)] AS FLOAT) > 8)", ct);

        // Consistency: how many task_daily crew_types (last 90 days) have NO match in PH_PRODUCTIVITY_WEEKLY_REPORT?
        //   Those crews can never get a P-Rating — all Unrated.
        var unmatchedCrewTypes = await Count(conn,
            "SELECT COUNT(DISTINCT td.crew_type) " +
            "FROM [dbo].[task_daily] td WITH (NOLOCK) " +
            $"WHERE td.ActionOn >= '{startDate:yyyy-MM-dd}' AND td.ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND td.crew_type IS NOT NULL AND td.crew_type <> '' " +
            "AND NOT EXISTS(" +
            "  SELECT 1 FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] ph WITH (NOLOCK) " +
            "  WHERE ph.[Crew Type] = td.crew_type AND ph.[Crew Type] IS NOT NULL)", ct);

        // Integrity: duplicate [Crew Type] rows (multiple rows per type; only the top-PI row is used)
        var phDupCrewType = await Count(conn,
            "SELECT COUNT(*) FROM (" +
            "  SELECT [Crew Type], COUNT(*) AS n " +
            "  FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "  WHERE [Crew Type] IS NOT NULL AND LTRIM(RTRIM([Crew Type])) <> '' " +
            "  GROUP BY [Crew Type] HAVING COUNT(*) > 1" +
            ") x", ct);

        var sampleUnmatchedTypes = await Rows(conn,
            "SELECT TOP 5 td.crew_type, COUNT(DISTINCT td.crew_code) AS crew_count, MAX(td.ActionOn) AS last_action " +
            "FROM [dbo].[task_daily] td WITH (NOLOCK) " +
            $"WHERE td.ActionOn >= '{startDate:yyyy-MM-dd}' AND td.ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND td.crew_type IS NOT NULL AND td.crew_type <> '' " +
            "AND NOT EXISTS(" +
            "  SELECT 1 FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] ph WITH (NOLOCK) " +
            "  WHERE ph.[Crew Type] = td.crew_type) " +
            "GROUP BY td.crew_type ORDER BY COUNT(DISTINCT td.crew_code) DESC", 5, ct);
        var sampleBadPI = await Rows(conn,
            "SELECT TOP 5 [Crew Type], CAST([Month PI (CMR)] AS NVARCHAR(50)) AS pi_raw " +
            "FROM [dbo].[PH_PRODUCTIVITY_WEEKLY_REPORT] WITH (NOLOCK) " +
            "WHERE [Month PI (CMR)] IS NOT NULL " +
            "AND LTRIM(RTRIM(CAST([Month PI (CMR)] AS NVARCHAR(50)))) <> '' " +
            "AND TRY_CAST([Month PI (CMR)] AS FLOAT) IS NULL " +
            "AND CAST([Month PI (CMR)] AS NVARCHAR(50)) NOT LIKE 'P[0-9]%'", 5, ct);

        double phComplete = Rate(phNullCrewType + phNullPI, Math.Max(phTotal + phDistinctCrewTypes, 1));
        double phValid    = Rate(phBadPI + phOutOfRange, Math.Max(phTotal, 1));
        double phConsist  = Rate(unmatchedCrewTypes, Math.Max(phDistinctCrewTypes + unmatchedCrewTypes, 1));
        double phInteg    = Rate(phDupCrewType, Math.Max(phTotal, 1));
        double phScore    = NaScore(phTotal, ApplyGate(WeightedScore(phComplete, phValid, phConsist, phInteg, freshnessTd), phComplete, phInteg));

        var phIssues = new List<object>();
        if (phNullCrewType > 0) phIssues.Add(Issue("[Crew Type]",        $"{phNullCrewType} rows have NULL/empty [Crew Type] — the enrichment JOIN uses this as the key to task_daily.crew_type. Those rows are unreachable and contribute nothing to any crew's P-Rating.", "Completeness", "High", phNullCrewType));
        if (phNullPI > 0)       phIssues.Add(Issue("[Month PI (CMR)]",   $"{phNullPI} distinct Crew Types have no row with a non-null [Month PI (CMR)]. The enrichment picks the top-PI row per Crew Type (ROW_NUMBER ORDER BY ISNULL(PI,0) DESC) — if all rows for a Crew Type have NULL PI, the joined crew gets pRating=null and lands in the Unrated bucket.", "Completeness", "High", phNullPI));
        if (phBadPI > 0)        phIssues.Add(Issue("[Month PI (CMR)]",   $"{phBadPI} rows have a non-numeric, non 'P#' value for [Month PI (CMR)]. The enrichment code stores the raw string as pRating — if it doesn't match P0–P8, it will never group into a P-band and those crews land in Unrated.", "Validity", "High", phBadPI, sampleBadPI));
        if (phOutOfRange > 0)   phIssues.Add(Issue("[Month PI (CMR)]",   $"{phOutOfRange} rows have a numeric PI outside the expected 0–8 range. The code converts numeric values as 'P'+round(n) — values like 9 or 10 produce 'P9' / 'P10' which are not a valid P-band and are silently excluded from all 9 chart bars.", "Validity", "Medium", phOutOfRange));
        if (unmatchedCrewTypes > 0) phIssues.Add(Issue("[Crew Type] ↔ task_daily.crew_type", $"{unmatchedCrewTypes} distinct crew_type values active in the last 90 days have no matching [Crew Type] in PH_PRODUCTIVITY_WEEKLY_REPORT. All crews with those types receive no P-Rating — Unrated bucket inflated by the entire crew population of those types.", "Consistency", "High", unmatchedCrewTypes, sampleUnmatchedTypes));
        if (phDupCrewType > 0)  phIssues.Add(Issue("[Crew Type] duplicates", $"{phDupCrewType} Crew Type values have more than one row. Enrichment picks only the row with the highest [Month PI (CMR)] (ROW_NUMBER rn=1). Lower-PI rows for the same type are silently discarded, which means the chart always shows the most optimistic rating available — not necessarily the most recent.", "Integrity", "Medium", phDupCrewType));

        // ── dbo.OLD_NEW_CREW_MAPPING (CREW_GROUP_CODE deduplication) ──────────
        // The distribution deduplicates by CREW_GROUP_CODE:
        //   crewGroupCodes.FirstOrDefault(g => crew_code.Contains(g, OrdinalIgnoreCase))
        // Any crew whose crew_code does NOT contain any CREW_GROUP_CODE is Where(x => GroupCode is not null) → DROPPED.
        var mappingTotal = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[OLD_NEW_CREW_MAPPING] WITH (NOLOCK)", ct);
        var mapDistinctGroupCodes = await Count(conn,
            "SELECT COUNT(DISTINCT LTRIM(RTRIM(CREW_GROUP_CODE))) FROM [dbo].[OLD_NEW_CREW_MAPPING] WITH (NOLOCK) " +
            "WHERE CREW_GROUP_CODE IS NOT NULL AND LTRIM(RTRIM(CREW_GROUP_CODE)) <> ''", ct);

        // Completeness: NULL/empty CREW_GROUP_CODE — that row cannot dedup any crew
        var mapNullGroupCode = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[OLD_NEW_CREW_MAPPING] WITH (NOLOCK) " +
            "WHERE CREW_GROUP_CODE IS NULL OR LTRIM(RTRIM(CREW_GROUP_CODE)) = ''", ct);

        // Integrity: how many active crew_codes in task_daily do NOT contain any CREW_GROUP_CODE?
        //   Those are silently dropped from the distribution — they do NOT appear in Unrated either.
        //   (The .Where(x => GroupCode is not null) filter removes them entirely before distribution counting.)
        var droppedCrews = await Count(conn,
            "SELECT COUNT(DISTINCT td.crew_code) " +
            "FROM [dbo].[task_daily] td WITH (NOLOCK) " +
            $"WHERE td.ActionOn >= '{startDate:yyyy-MM-dd}' AND td.ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND td.crew_code IS NOT NULL AND td.crew_code <> '' " +
            "AND NOT EXISTS(" +
            "  SELECT 1 FROM [dbo].[OLD_NEW_CREW_MAPPING] m WITH (NOLOCK) " +
            "  WHERE m.CREW_GROUP_CODE IS NOT NULL AND m.CREW_GROUP_CODE <> '' " +
            "  AND td.crew_code LIKE '%' + LTRIM(RTRIM(m.CREW_GROUP_CODE)) + '%')", ct);

        var sampleDropped = await Rows(conn,
            "SELECT TOP 5 td.crew_code, COUNT(*) AS days_active " +
            "FROM [dbo].[task_daily] td WITH (NOLOCK) " +
            $"WHERE td.ActionOn >= '{startDate:yyyy-MM-dd}' AND td.ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND td.crew_code IS NOT NULL AND td.crew_code <> '' " +
            "AND NOT EXISTS(" +
            "  SELECT 1 FROM [dbo].[OLD_NEW_CREW_MAPPING] m WITH (NOLOCK) " +
            "  WHERE m.CREW_GROUP_CODE IS NOT NULL AND m.CREW_GROUP_CODE <> '' " +
            "  AND td.crew_code LIKE '%' + LTRIM(RTRIM(m.CREW_GROUP_CODE)) + '%') " +
            "GROUP BY td.crew_code ORDER BY COUNT(*) DESC", 5, ct);

        double mapComplete = Rate(mapNullGroupCode, Math.Max(mappingTotal, 1));
        double mapInteg    = Rate(droppedCrews, Math.Max(tdDistinctCrews, 1));
        double mapScore    = NaScore(mappingTotal, ApplyGate(WeightedScore(mapComplete, 1.0, 1.0, mapInteg, 1.0), mapComplete, mapInteg));

        var mapIssues = new List<object>();
        if (droppedCrews > 0)
        {
            mapIssues.Add(Issue("CREW_GROUP_CODE (dedup key)",
                $"{droppedCrews} crew_codes active in the last 90 days do not contain any CREW_GROUP_CODE as a substring — those crews are completely absent from the P-Rating distribution chart. They are neither counted in P0–P8 nor in Unrated.",
                "Integrity", "High", droppedCrews, sampleDropped));
        }
        if (mapNullGroupCode > 0) mapIssues.Add(Issue("CREW_GROUP_CODE", $"{mapNullGroupCode} rows have NULL/empty CREW_GROUP_CODE — those rows cannot be used as dedup keys; any crew_code that would have matched only those rows is dropped from the distribution.", "Completeness", "High", mapNullGroupCode));

        // ── dbo.SAP_DRILLING_SEQUENCE_History (cluster for filter support) ────
        // Cluster is resolved in the enrichment JOIN via:
        //   LEFT JOIN SAP_DRILLING_SEQUENCE_History ON Well_ID = task_daily.well_id
        // The cluster value is used only when a cluster filter is applied.
        var sapTotal = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE Well_ID IS NOT NULL AND Well_ID <> '' AND Field IS NOT NULL AND LTRIM(RTRIM(Field)) <> ''", ct);

        // Wells in task_daily (last 90 days) that have no cluster row in SAP
        var sapUnmatchedWells = await Count(conn,
            "SELECT COUNT(DISTINCT td.well_id) " +
            "FROM [dbo].[task_daily] td WITH (NOLOCK) " +
            $"WHERE td.ActionOn >= '{startDate:yyyy-MM-dd}' AND td.ActionOn < '{endDate:yyyy-MM-dd}' " +
            "AND td.well_id IS NOT NULL AND td.well_id <> '' " +
            "AND NOT EXISTS(" +
            "  SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) " +
            "  WHERE s.Well_ID = td.well_id AND s.Field IS NOT NULL AND LTRIM(RTRIM(s.Field)) <> '')", ct);

        double sapInteg = Rate(sapUnmatchedWells, Math.Max(sapTotal + sapUnmatchedWells, 1));
        double sapScore = NaScore(sapTotal, ApplyGate(WeightedScore(1.0, 1.0, 1.0, sapInteg, freshnessTd), 1.0, sapInteg));

        var sapIssues = new List<object>();
        if (sapUnmatchedWells > 0) sapIssues.Add(Issue("Well_ID / Field",
            $"{sapUnmatchedWells} distinct wells active in task_daily (last 90 days) have no matching row with a non-null Field (cluster) in SAP_DRILLING_SEQUENCE_History. When a Cluster filter is applied to the P-Rating chart, those crews are excluded from the filtered distribution — their P-Ratings disappear from the chart silently.",
            "Integrity", "Medium", sapUnmatchedWells));

        // ── Overall score ─────────────────────────────────────────────────────
        // Weight: task_daily 40%, PH_PRODUCTIVITY_WEEKLY_REPORT 35%, OLD_NEW_CREW_MAPPING 25%
        // (SAP contributes to cluster filtering only, not core distribution — folded into td score)
        double overall = tdScore * 0.40 + phScore * 0.35 + mapScore * 0.25;

        return BuildResponse("crewPRating",
            "Crew P-Rating Distribution chart. Real data flow: " +
            "dbo.task_daily (last 90 days, crew_code + crew_type) → " +
            "LEFT JOIN dbo.PH_PRODUCTIVITY_WEEKLY_REPORT ON [Crew Type] (top PI row per type) → P-Rating value. " +
            "Deduplication: OLD_NEW_CREW_MAPPING.CREW_GROUP_CODE substring match on crew_code — unmatched crews are silently dropped. " +
            "Cluster filter: LEFT JOIN dbo.SAP_DRILLING_SEQUENCE_History ON Well_ID for Field (cluster). " +
            "Enrichment cached in-process; refreshed on a dynamic interval (5–15 min).",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.task_daily",                      totalRows = tdTotal,       reliabilityScore = Math.Round(tdScore,  1), reliabilityLabel = Label(tdScore),  issues = tdIssues  },
                new { table = "dbo.PH_PRODUCTIVITY_WEEKLY_REPORT",   totalRows = phTotal,       reliabilityScore = Math.Round(phScore,  1), reliabilityLabel = Label(phScore),  issues = phIssues  },
                new { table = "dbo.OLD_NEW_CREW_MAPPING (CREW_GROUP_CODE)", totalRows = mappingTotal, reliabilityScore = Math.Round(mapScore, 1), reliabilityLabel = Label(mapScore), issues = mapIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History",   totalRows = sapTotal,      reliabilityScore = Math.Round(sapScore, 1), reliabilityLabel = Label(sapScore), issues = sapIssues }
            });
    }

    // =========================================================================
    // 12. WELLS PLANNED vs ACTUAL (WPA) — CMD Readiness KPI
    //     Sources:
    //       dbo.ActivityTaskPlan            — planned wells (summary endpoint)
    //       dbo.WMR_TaskPlan_csv_imported   — planned wells (drilldown endpoint)
    //       dbo.task_daily                  — executed wells
    //       dbo.ProjectIDs                 — cluster/site/wellType/project filter
    //       dbo.WMR                        — document compliance (4 fields per well)
    //     KPI tiles: Planned Wells, Executed as Plan, Executed Not as Plan,
    //                Non Executed as Plan, Document Submitted.
    // =========================================================================
    private async Task<object> QualityWpaReadiness(CancellationToken ct)
    {
        await using var conn = Open();

        // ── 1. ActivityTaskPlan — single-scan aggregation ────────────────────
        long atpTotal = 0, atpDistinct = 0, atpNullWellId = 0, atpNullStart = 0,
             atpNullEnd = 0, atpNullQty = 0, atpEndBeforeStart = 0, atpZeroQty = 0;
        string? atpLatest = null;
        {
            const string sql = @"
                SELECT
                    COUNT(*)                                                                              AS total,
                    COUNT(DISTINCT CASE WHEN Well_ID IS NOT NULL AND Well_ID<>'' THEN Well_ID END)         AS distinct_wells,
                    SUM(CASE WHEN Well_ID IS NULL OR Well_ID='' THEN 1 ELSE 0 END)                         AS null_well_id,
                    SUM(CASE WHEN target_start IS NULL OR TRY_CAST(target_start AS DATE) IS NULL THEN 1 ELSE 0 END) AS null_start,
                    SUM(CASE WHEN target_end   IS NULL OR TRY_CAST(target_end   AS DATE) IS NULL THEN 1 ELSE 0 END) AS null_end,
                    SUM(CASE WHEN qtyforacst IS NULL OR TRY_CAST(qtyforacst AS NUMERIC(18,5)) IS NULL THEN 1 ELSE 0 END) AS null_qty,
                    SUM(CASE WHEN TRY_CAST(target_start AS DATE) IS NOT NULL
                              AND TRY_CAST(target_end   AS DATE) IS NOT NULL
                              AND TRY_CAST(target_end AS DATE) < TRY_CAST(target_start AS DATE) THEN 1 ELSE 0 END) AS end_before_start,
                    SUM(CASE WHEN qtyforacst IS NOT NULL AND TRY_CAST(qtyforacst AS NUMERIC(18,5)) IN (0, 0.00001) THEN 1 ELSE 0 END) AS zero_qty,
                    CONVERT(NVARCHAR(12), MAX(TRY_CAST(target_end AS DATE)))                               AS latest_end
                FROM [dbo].[ActivityTaskPlan] WITH (NOLOCK)";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                atpTotal          = r.IsDBNull(0) ? 0 : r.GetInt32(0);
                atpDistinct       = r.IsDBNull(1) ? 0 : r.GetInt32(1);
                atpNullWellId     = r.IsDBNull(2) ? 0 : r.GetInt32(2);
                atpNullStart      = r.IsDBNull(3) ? 0 : r.GetInt32(3);
                atpNullEnd        = r.IsDBNull(4) ? 0 : r.GetInt32(4);
                atpNullQty        = r.IsDBNull(5) ? 0 : r.GetInt32(5);
                atpEndBeforeStart = r.IsDBNull(6) ? 0 : r.GetInt32(6);
                atpZeroQty        = r.IsDBNull(7) ? 0 : r.GetInt32(7);
                atpLatest         = r.IsDBNull(8) ? null : r.GetString(8);
            }
        }

        int atpDays = atpLatest is not null && DateOnly.TryParse(atpLatest, out var atpLw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - atpLw.DayNumber : 999;
        double atpFresh = FreshnessRate(atpDays, 7, 53);

        double atpComplete = Rate(atpNullWellId + atpNullStart + atpNullEnd + atpNullQty, atpTotal * 4);
        double atpValid    = Rate(atpEndBeforeStart + atpZeroQty, atpTotal * 2);
        double atpScore    = NaScore(atpTotal, ApplyGate(WeightedScore(atpComplete, atpValid, 1.0, 1.0, atpFresh), atpComplete, 1.0));

        var atpIssues = new List<object>();
        if (atpNullWellId > 0)     atpIssues.Add(Issue("Well_ID", $"{atpNullWellId} rows have NULL/empty Well_ID — invisible to all WPA counts", "Completeness", "High", atpNullWellId));
        if (atpNullStart > 0)      atpIssues.Add(Issue("target_start", $"{atpNullStart} rows have NULL/unparseable target_start — cannot match week filter", "Completeness", "High", atpNullStart));
        if (atpNullEnd > 0)        atpIssues.Add(Issue("target_end", $"{atpNullEnd} rows have NULL/unparseable target_end", "Completeness", "High", atpNullEnd));
        if (atpNullQty > 0)        atpIssues.Add(Issue("qtyforacst", $"{atpNullQty} rows have NULL/unparseable qtyforacst — excluded from planned count", "Completeness", "Medium", atpNullQty));
        if (atpEndBeforeStart > 0) atpIssues.Add(Issue("target_start / target_end", $"{atpEndBeforeStart} rows where target_end < target_start — impossible date range", "Validity", "High", atpEndBeforeStart));
        if (atpZeroQty > 0)        atpIssues.Add(Issue("qtyforacst", $"{atpZeroQty} rows have qtyforacst = 0 or 0.00001 — excluded from planned counts", "Validity", "Low", atpZeroQty));
        if (atpDays > 7)           atpIssues.Add(Issue("target_end", $"Latest target_end is {atpDays} days ago ({atpLatest})", "Freshness", atpDays > 30 ? "High" : "Medium", atpDays));

        // ── 2. task_daily — single-scan aggregation ──────────────────────────
        long tdTotal = 0, tdDistinct = 0, tdNullWellId = 0, tdSentinelId = 0,
             tdNullActionOn = 0, tdNullTaskCode = 0, tdNullDataQty = 0, tdZeroQty = 0, tdOneQty = 0;
        string? tdLatest = null;
        {
            const string sql = @"
                SELECT
                    COUNT(*)                                                                                          AS total,
                    COUNT(DISTINCT CASE WHEN well_id IS NOT NULL AND well_id<>'' AND well_id NOT IN ('00000','00001','0') THEN well_id END) AS distinct_wells,
                    SUM(CASE WHEN well_id IS NULL OR well_id='' THEN 1 ELSE 0 END)                                     AS null_well_id,
                    SUM(CASE WHEN well_id IN ('00000','00001','0') THEN 1 ELSE 0 END)                                  AS sentinel_id,
                    SUM(CASE WHEN ActionOn IS NULL OR TRY_CAST(ActionOn AS DATE) IS NULL THEN 1 ELSE 0 END)            AS null_action,
                    SUM(CASE WHEN task_code IS NULL OR task_code='' THEN 1 ELSE 0 END)                                 AS null_task_code,
                    SUM(CASE WHEN data_qty IS NULL THEN 1 ELSE 0 END)                                                  AS null_data_qty,
                    SUM(CASE WHEN data_qty = 0 THEN 1 ELSE 0 END)                                                      AS zero_qty,
                    SUM(CASE WHEN data_qty = 1 THEN 1 ELSE 0 END)                                                      AS one_qty,
                    CONVERT(NVARCHAR(12), MAX(TRY_CAST(ActionOn AS DATE)))                                             AS latest_action
                FROM [dbo].[task_daily] WITH (NOLOCK)";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                tdTotal        = r.IsDBNull(0) ? 0 : r.GetInt32(0);
                tdDistinct     = r.IsDBNull(1) ? 0 : r.GetInt32(1);
                tdNullWellId   = r.IsDBNull(2) ? 0 : r.GetInt32(2);
                tdSentinelId   = r.IsDBNull(3) ? 0 : r.GetInt32(3);
                tdNullActionOn = r.IsDBNull(4) ? 0 : r.GetInt32(4);
                tdNullTaskCode = r.IsDBNull(5) ? 0 : r.GetInt32(5);
                tdNullDataQty  = r.IsDBNull(6) ? 0 : r.GetInt32(6);
                tdZeroQty      = r.IsDBNull(7) ? 0 : r.GetInt32(7);
                tdOneQty       = r.IsDBNull(8) ? 0 : r.GetInt32(8);
                tdLatest       = r.IsDBNull(9) ? null : r.GetString(9);
            }
        }

        int tdDays = tdLatest is not null && DateOnly.TryParse(tdLatest, out var tdLw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - tdLw.DayNumber : 999;
        double tdFresh = FreshnessRate(tdDays, 1, 6);

        double tdComplete = Rate(tdNullWellId + tdSentinelId + tdNullActionOn + tdNullTaskCode + tdNullDataQty, tdTotal * 5);
        double tdValid    = Rate(tdZeroQty + tdOneQty, tdTotal * 2);
        double tdScore2   = NaScore(tdTotal, ApplyGate(WeightedScore(tdComplete, tdValid, 1.0, 1.0, tdFresh), tdComplete, 1.0));

        var tdIssues = new List<object>();
        if (tdNullWellId > 0)   tdIssues.Add(Issue("well_id", $"{tdNullWellId} rows have NULL/empty well_id — invisible to WPA counts", "Completeness", "High", tdNullWellId));
        if (tdSentinelId > 0)   tdIssues.Add(Issue("well_id", $"{tdSentinelId} rows use sentinel values (00000/00001/0) — excluded", "Completeness", "Medium", tdSentinelId));
        if (tdNullActionOn > 0) tdIssues.Add(Issue("ActionOn", $"{tdNullActionOn} rows have NULL/unparseable ActionOn — cannot determine week", "Completeness", "High", tdNullActionOn));
        if (tdNullTaskCode > 0) tdIssues.Add(Issue("task_code", $"{tdNullTaskCode} rows have NULL/empty task_code — excluded", "Completeness", "Medium", tdNullTaskCode));
        if (tdNullDataQty > 0)  tdIssues.Add(Issue("data_qty", $"{tdNullDataQty} rows have NULL data_qty — excluded", "Completeness", "Medium", tdNullDataQty));
        if (tdZeroQty > 0)      tdIssues.Add(Issue("data_qty", $"{tdZeroQty} rows have data_qty = 0 — excluded from execution counts", "Validity", "Low", tdZeroQty));
        if (tdOneQty > 0)       tdIssues.Add(Issue("data_qty", $"{tdOneQty} rows have data_qty = 1 — excluded from executed-not-as-plan", "Validity", "Low", tdOneQty));
        if (tdDays > 1)         tdIssues.Add(Issue("ActionOn", $"Latest record is {tdDays} days old ({tdLatest})", "Freshness", tdDays > 3 ? "High" : "Medium", tdDays));

        // ── 3. WMR_TaskPlan_csv_imported — single-scan ───────────────────────
        long tpTotal = 0, tpDistinct = 0, tpNullWellId = 0, tpNullStart = 0;
        {
            const string sql = @"
                SELECT
                    COUNT(*)                                                                                     AS total,
                    COUNT(DISTINCT CASE WHEN [New_Well_ID] IS NOT NULL AND [New_Well_ID]<>'' THEN [New_Well_ID] END) AS distinct_wells,
                    SUM(CASE WHEN [New_Well_ID] IS NULL OR [New_Well_ID]='' THEN 1 ELSE 0 END)                    AS null_well_id,
                    SUM(CASE WHEN actual_start IS NULL OR TRY_CAST(actual_start AS DATE) IS NULL THEN 1 ELSE 0 END) AS null_start
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                tpTotal      = r.IsDBNull(0) ? 0 : r.GetInt32(0);
                tpDistinct   = r.IsDBNull(1) ? 0 : r.GetInt32(1);
                tpNullWellId = r.IsDBNull(2) ? 0 : r.GetInt32(2);
                tpNullStart  = r.IsDBNull(3) ? 0 : r.GetInt32(3);
            }
        }

        double tpComplete = Rate(tpNullWellId, tpTotal);
        double tpScore    = NaScore(tpTotal, ApplyGate(WeightedScore(tpComplete, 1.0, 1.0, 1.0, 1.0), tpComplete, 1.0));

        var tpIssues = new List<object>();
        if (tpNullWellId > 0) tpIssues.Add(Issue("New_Well_ID", $"{tpNullWellId} rows have NULL/empty New_Well_ID — invisible to drilldown", "Completeness", "High", tpNullWellId));
        if (tpNullStart > 0)  tpIssues.Add(Issue("actual_start", $"{tpNullStart} rows have NULL actual_start — expected for tasks not yet started (informational only)", "Completeness", "Low", tpNullStart));

        // ── 4. WMR (document compliance) — single-scan ───────────────────────
        long wmrTotal = 0, wmrDistinct = 0, wmrNullLocPo = 0, wmrNullPegged = 0,
             wmrNullFlaf = 0, wmrNullFlowPo = 0, wmrDupWellWeek = 0;
        string? wmrLatest = null;
        {
            const string sql = @"
                SELECT
                    COUNT(*)                                                                                     AS total,
                    COUNT(DISTINCT CASE WHEN pdo_well_id IS NOT NULL AND pdo_well_id<>'' THEN pdo_well_id END)    AS distinct_wells,
                    COUNT(DISTINCT CASE WHEN pdo_well_id IS NOT NULL AND (location_po_no IS NULL OR LTRIM(RTRIM(location_po_no))='') THEN pdo_well_id END) AS null_loc_po,
                    COUNT(DISTINCT CASE WHEN pdo_well_id IS NOT NULL AND (actual_pegged_date IS NULL OR LTRIM(RTRIM(CAST(actual_pegged_date AS NVARCHAR(50))))='') THEN pdo_well_id END) AS null_pegged,
                    COUNT(DISTINCT CASE WHEN pdo_well_id IS NOT NULL AND (flaf_issue_date IS NULL OR LTRIM(RTRIM(CAST(flaf_issue_date AS NVARCHAR(50))))='') THEN pdo_well_id END) AS null_flaf,
                    COUNT(DISTINCT CASE WHEN pdo_well_id IS NOT NULL AND (flow_line_po_no IS NULL OR LTRIM(RTRIM(flow_line_po_no))='') THEN pdo_well_id END) AS null_flow_po,
                    CONVERT(NVARCHAR(12), MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) AS latest_week
                FROM [dbo].[WMR] WITH (NOLOCK)";
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                wmrTotal      = r.IsDBNull(0) ? 0 : r.GetInt32(0);
                wmrDistinct   = r.IsDBNull(1) ? 0 : r.GetInt32(1);
                wmrNullLocPo  = r.IsDBNull(2) ? 0 : r.GetInt32(2);
                wmrNullPegged = r.IsDBNull(3) ? 0 : r.GetInt32(3);
                wmrNullFlaf   = r.IsDBNull(4) ? 0 : r.GetInt32(4);
                wmrNullFlowPo = r.IsDBNull(5) ? 0 : r.GetInt32(5);
                wmrLatest     = r.IsDBNull(6) ? null : r.GetString(6);
            }
        }

        // Separate query for duplicates (GROUP BY needs its own scan)
        wmrDupWellWeek = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        int wmrDays = wmrLatest is not null && DateOnly.TryParse(wmrLatest, out var wmrLw)
            ? (DateOnly.FromDateTime(DateTime.UtcNow)).DayNumber - wmrLw.DayNumber : 999;
        double wmrFresh = FreshnessRate(wmrDays, 7, 7);

        double wmrComplete = Rate(wmrNullLocPo + wmrNullPegged + wmrNullFlaf + wmrNullFlowPo, wmrDistinct * 4);
        double wmrInteg    = Rate(wmrDupWellWeek, wmrTotal);
        double wmrScore    = NaScore(wmrTotal, ApplyGate(WeightedScore(wmrComplete, 1.0, 1.0, wmrInteg, wmrFresh), wmrComplete, wmrInteg));

        var wmrIssues = new List<object>();
        if (wmrNullLocPo > 0)  wmrIssues.Add(Issue("location_po_no", $"{wmrNullLocPo} distinct wells have NULL/empty location_po_no", "Completeness", "Medium", wmrNullLocPo));
        if (wmrNullPegged > 0) wmrIssues.Add(Issue("actual_pegged_date", $"{wmrNullPegged} distinct wells have NULL/empty actual_pegged_date", "Completeness", "Medium", wmrNullPegged));
        if (wmrNullFlaf > 0)   wmrIssues.Add(Issue("flaf_issue_date", $"{wmrNullFlaf} distinct wells have NULL/empty flaf_issue_date", "Completeness", "Medium", wmrNullFlaf));
        if (wmrNullFlowPo > 0) wmrIssues.Add(Issue("flow_line_po_no", $"{wmrNullFlowPo} distinct wells have NULL/empty flow_line_po_no", "Completeness", "Medium", wmrNullFlowPo));
        if (wmrDupWellWeek > 0)wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{wmrDupWellWeek} duplicate (pdo_well_id, Week_Number) pairs", "Integrity", "High", wmrDupWellWeek));
        if (wmrDays > 7)       wmrIssues.Add(Issue("Week_Number", $"Latest WMR snapshot is {wmrDays} days old ({wmrLatest})", "Freshness", wmrDays > 14 ? "High" : "Medium", wmrDays));

        // ── Overall ──────────────────────────────────────────────────────────
        double wpaOverall = atpScore * 0.30 + tdScore2 * 0.30 + tpScore * 0.15 + wmrScore * 0.25;

        return BuildResponse("wpaReadiness",
            "Wells Planned vs Actual (WPA) KPI widget. " +
            "Summary: dbo.ActivityTaskPlan (planned) + dbo.task_daily (executed). " +
            "Drilldown: dbo.WMR_TaskPlan_csv_imported (planned). " +
            "Documents: dbo.WMR (4 fields per well).",
            Math.Round(wpaOverall, 1),
            new List<object>
            {
                new { table = "dbo.ActivityTaskPlan",          totalRows = atpTotal, reliabilityScore = Math.Round(atpScore, 1), reliabilityLabel = Label(atpScore), issues = atpIssues },
                new { table = "dbo.task_daily",                totalRows = tdTotal,  reliabilityScore = Math.Round(tdScore2, 1), reliabilityLabel = Label(tdScore2), issues = tdIssues },
                new { table = "dbo.WMR_TaskPlan_csv_imported", totalRows = tpTotal,  reliabilityScore = Math.Round(tpScore,  1), reliabilityLabel = Label(tpScore),  issues = tpIssues },
                new { table = "dbo.WMR (documents)",           totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues }
            });
    }

    // =========================================================================
    // 13. WELL HOOKUP PROGRESS — dbo.WellMonitoringReport_Latest + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityHookupProgress(CancellationToken ct)
    {
        await using var conn = Open();

        // ── WellMonitoringReport_Latest ──────────────────────────────────────
        var wmrTotal        = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK)", ct);
        var wmrNullWellId   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id = ''", ct);
        var wmrNullProjId   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE project_id IS NULL OR project_id = ''", ct);
        var wmrNullRigOff   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '' AND (actual_rig_off_date IS NULL OR LTRIM(RTRIM(CAST(actual_rig_off_date AS NVARCHAR(100)))) = '')", ct);
        var wmrBadRigOff    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE actual_rig_off_date IS NOT NULL AND LTRIM(RTRIM(CAST(actual_rig_off_date AS NVARCHAR(100)))) <> '' AND TRY_CONVERT(DATE, CAST(actual_rig_off_date AS NVARCHAR(100))) IS NULL", ct);
        var wmrNullEngComp  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '' AND [actual_eng._completion_date] IS NULL", ct);
        var wmrNullHookComp = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '' AND [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL", ct);
        var wmrNullScrNo    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '' AND (scr_no IS NULL OR LTRIM(RTRIM(CAST(scr_no AS NVARCHAR(200)))) = '')", ct);

        // Freshness: check if any data was updated in the last 14 days
        var latestUpdateStr = await Scalar(conn,
            "SELECT MAX(CAST(actual_rig_off_date AS NVARCHAR(100))) FROM [dbo].[WellMonitoringReport_Latest] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''", ct);
        var wmrDays = 0;
        if (DateTime.TryParse(latestUpdateStr, out var wmrLatest))
            wmrDays = (int)(DateTime.Today - wmrLatest).TotalDays;

        var wmrIssues = new List<object>();
        if (wmrNullWellId > 0)   wmrIssues.Add(Issue("pdo_well_id",     $"{wmrNullWellId} rows have NULL/empty pdo_well_id — excluded from all hookup counts", "Completeness", "High",   wmrNullWellId));
        if (wmrNullProjId > 0)   wmrIssues.Add(Issue("project_id",      $"{wmrNullProjId} rows have NULL/empty project_id — cannot be scoped to ProjectIDs type (Conventional/Non-Standard)", "Completeness", "High",   wmrNullProjId));
        if (wmrNullRigOff > 0)   wmrIssues.Add(Issue("actual_rig_off_date", $"{wmrNullRigOff} wells have NULL/empty rig-off date — excluded when a date range filter is applied", "Completeness", "Medium", wmrNullRigOff));
        if (wmrBadRigOff > 0)    wmrIssues.Add(Issue("actual_rig_off_date", $"{wmrBadRigOff} rows have a non-parseable rig-off date — TRY_CONVERT returns NULL, treated as no rig-off", "Validity",     "High",   wmrBadRigOff));
        if (wmrNullEngComp > 0)  wmrIssues.Add(Issue("actual_eng._completion_date", $"{wmrNullEngComp} wells missing engineering completion date — classified as Not Hooked-Up", "Completeness", "Medium", wmrNullEngComp));
        if (wmrNullHookComp > 0) wmrIssues.Add(Issue("actual_comm._finish_date…",  $"{wmrNullHookComp} wells missing hookup completion date — may undercount Hook-Up Completed tile", "Completeness", "Medium", wmrNullHookComp));
        if (wmrNullScrNo > 0)    wmrIssues.Add(Issue("scr_no",          $"{wmrNullScrNo} wells have NULL/empty scr_no — not classified as FLAF/SCR-delayed (may inflate After FLAF/SCR count)", "Completeness", "Low",    wmrNullScrNo));
        if (wmrDays > 7)         wmrIssues.Add(Issue("actual_rig_off_date", $"Freshest rig-off date is {wmrDays} days old — WellMonitoringReport_Latest may not reflect this week's activity", "Freshness", wmrDays > 14 ? "High" : "Medium", wmrDays));

        double wmrComplete  = Rate(wmrNullWellId + wmrNullProjId, wmrTotal);
        double wmrValidity  = Rate(wmrBadRigOff, wmrTotal);
        double wmrConsist   = Rate(wmrNullEngComp + wmrNullHookComp, Math.Max(1, wmrTotal - wmrNullWellId));
        double wmrFresh     = FreshnessRate(wmrDays, 7, 7);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(wmrComplete, wmrValidity, wmrConsist, 1.0, wmrFresh), wmrComplete, 1.0));

        // ── ProjectIDs ───────────────────────────────────────────────────────
        var pidTotal       = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullType    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Type] IS NULL OR LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) = ''", ct);
        var pidNullCluster = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = ''", ct);
        var pidNullId      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [ID] IS NULL", ct);
        // Type values should match exactly 'Conventional Well', 'Non Standard Well', etc.
        var pidBadType     = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Type] IS NOT NULL AND LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) NOT IN ('Conventional Well','Non Standard Well','Well Conversion')", ct);

        var pidIssues = new List<object>();
        if (pidNullType > 0)    pidIssues.Add(Issue("[Type]",    $"{pidNullType} ProjectIDs rows have NULL/empty Type — those wells cannot be routed to a hookup tab (Conventional/Non-Standard/Conversions)", "Completeness", "High",   pidNullType));
        if (pidNullCluster > 0) pidIssues.Add(Issue("[Cluster]", $"{pidNullCluster} rows have NULL/empty Cluster — cluster filter will not match these projects", "Completeness", "Medium", pidNullCluster));
        if (pidNullId > 0)      pidIssues.Add(Issue("[ID]",      $"{pidNullId} rows have NULL ID — CAST(ID AS NVARCHAR) join to WellMonitoringReport_Latest.project_id will silently drop these rows", "Integrity",    "High",   pidNullId));
        if (pidBadType > 0)     pidIssues.Add(Issue("[Type]",    $"{pidBadType} rows have an unrecognised Type value — not matched to any hookup funnel", "Validity",     "Medium", pidBadType));

        double pidComplete = Rate(pidNullType + pidNullId, pidTotal);
        double pidValidity = Rate(pidBadType, pidTotal);
        double pidConsist  = Rate(pidNullCluster, pidTotal);
        double pidScore    = NaScore(pidTotal, ApplyGate(WeightedScore(pidComplete, pidValidity, pidConsist, 1.0, 1.0), pidComplete, 1.0));

        // ── Overall ──────────────────────────────────────────────────────────
        double overall = wmrScore * 0.70 + pidScore * 0.30;

        return BuildResponse("hookupProgress",
            "Well Hookup Progress Overview — Waterfall funnel (Original Plan → After FLAF/SCR → After PDO Issues → Completed) " +
            "and Overall Hook-Up % Completed donut. " +
            "Primary source: dbo.WellMonitoringReport_Latest (one row per well, latest snapshot). " +
            "Project scoping: dbo.ProjectIDs (routes each well to Conventional / Non-Standard / Well Conversions tab).",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WellMonitoringReport_Latest", totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.ProjectIDs",                   totalRows = pidTotal, reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // Cluster Operational Health (Layer 1) — dbo.WMR + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityClusterHealth(CancellationToken ct)
    {
        await using var conn = Open();
        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);
        var nullProgress  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NULL", ct);
        var nullRigOn     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND (actual_rig_on_date IS NULL OR actual_rig_on_date='')", ct);
        var nullExpRigOff = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND ([exp.rig_off_location_sap_data] IS NULL OR LTRIM(RTRIM(CAST([exp.rig_off_location_sap_data] AS NVARCHAR(100))))='')", ct);
        var badProgress   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NOT NULL AND TRY_CAST(REPLACE(CAST(over_all_progress_percentages AS NVARCHAR(50)),'%','') AS FLOAT) IS NULL", ct);
        var badRigOn      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE actual_rig_on_date IS NOT NULL AND actual_rig_on_date<>'' AND TRY_CAST(actual_rig_on_date AS DATE) IS NULL", ct);
        var badExpRigOff  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE [exp.rig_off_location_sap_data] IS NOT NULL AND LTRIM(RTRIM(CAST([exp.rig_off_location_sap_data] AS NVARCHAR(100))))<>'' AND TRY_CAST([exp.rig_off_location_sap_data] AS DATE) IS NULL", ct);
        var planEndBeforeStart = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE TRY_CAST(actual_rig_on_date AS DATE) IS NOT NULL AND TRY_CAST([exp.rig_off_location_sap_data] AS DATE) IS NOT NULL AND TRY_CAST([exp.rig_off_location_sap_data] AS DATE) < TRY_CAST(actual_rig_on_date AS DATE)", ct);
        var weekShort     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var orphanWells   = await Count(conn, "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' AND NOT EXISTS(SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100))=w.project_id)", ct);
        var multiProject  = await Count(conn, "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);
        var latestWeek    = await Scalar(conn, "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw) ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);
        double completeness  = Rate(nullProgress + nullRigOn + nullExpRigOff, wmrTotal * 3);
        double validity      = Rate(badProgress + badRigOn + badExpRigOff, wmrTotal * 3);
        double consistency   = Rate(planEndBeforeStart + (weekShort > 0 && weekLong > 0 ? Math.Min(weekShort, weekLong) : 0), distinctWells + wmrTotal);
        double integrity     = Rate(orphanWells + multiProject, distinctWells * 2);
        double wmrScore      = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));
        var wmrIssues = new List<object>();
        if (nullProgress > 0)       wmrIssues.Add(Issue("over_all_progress_percentages", $"{nullProgress} rows have NULL progress — treated as 0% by MAX().", "Completeness", "Medium", nullProgress));
        if (nullRigOn > 0)          wmrIssues.Add(Issue("actual_rig_on_date", $"{nullRigOn} wells have no rig-on date — Plan% cannot be computed.", "Completeness", "High", nullRigOn));
        if (nullExpRigOff > 0)      wmrIssues.Add(Issue("exp.rig_off_location_sap_data", $"{nullExpRigOff} wells have no expected rig-off date — Plan% forced to 0.", "Completeness", "High", nullExpRigOff));
        if (badProgress > 0)        wmrIssues.Add(Issue("over_all_progress_percentages", $"{badProgress} rows have unrecognisable progress format.", "Validity", "High", badProgress));
        if (badRigOn > 0)           wmrIssues.Add(Issue("actual_rig_on_date", $"{badRigOn} rows have unparseable rig-on date.", "Validity", "Medium", badRigOn));
        if (badExpRigOff > 0)       wmrIssues.Add(Issue("exp.rig_off_location_sap_data", $"{badExpRigOff} rows have unparseable expected rig-off date.", "Validity", "Medium", badExpRigOff));
        if (planEndBeforeStart > 0) wmrIssues.Add(Issue("actual_rig_on_date / exp.rig_off_location_sap_data", $"{planEndBeforeStart} wells have expected rig-off before actual rig-on.", "Consistency", "High", planEndBeforeStart));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number", $"Mixed formats: {weekShort} rows YY-MM-DD, {weekLong} rows YYYY-MM-DD.", "Consistency", "High", weekShort + weekLong));
        if (orphanWells > 0)        wmrIssues.Add(Issue("project_id", $"{orphanWells} wells match no ProjectIDs row — excluded from all cluster cards.", "Integrity", "High", orphanWells));
        if (multiProject > 0)       wmrIssues.Add(Issue("pdo_well_id / project_id", $"{multiProject} wells appear under more than one project_id.", "Integrity", "High", multiProject));
        if (days > 7)               wmrIssues.Add(Issue("Week_Number", $"Latest WMR snapshot is {days} days old ({latestWeek}).", "Freshness", days > 14 ? "High" : "Medium", days));
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0, 1.0, Rate(orphanWells, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullId + pidNullClust, pidTotal * 2), Rate(orphanWells, Math.Max(distinctWells, 1))));
        var pidIssues = new List<object>();
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster.", "Completeness", "High", pidNullClust));
        if (pidNullId > 0)    pidIssues.Add(Issue("ID", $"{pidNullId} rows have NULL ID — cannot be joined to WMR.project_id.", "Completeness", "High", pidNullId));
        if (orphanWells > 0) pidIssues.Add(Issue("ID (join type)", $"{orphanWells} WMR wells match no ProjectIDs.ID — no FK constraint enforces this join; those wells are excluded from all cluster cards.", "Integrity", "High", orphanWells));
        double overall = wmrScore * 0.70 + pidScore * 0.30;
        return BuildResponse("clusterHealth",
            "Cluster Operational Health (Layer 1). Sources: dbo.WMR + dbo.ProjectIDs. Plan% = elapsed days / planned duration. Actual% = MAX(over_all_progress_percentages).",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",        totalRows = wmrTotal,  reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.ProjectIDs", totalRows = pidTotal,  reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // Cluster Well Progress (Layer 2) — dbo.WMR + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityClusterWellProgress(CancellationToken ct)
    {
        await using var conn = Open();
        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);
        var nullWellId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullWellName  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND (well_name_after_spud IS NULL OR LTRIM(RTRIM(well_name_after_spud))='')", ct);
        var nullProgress  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND over_all_progress_percentages IS NULL", ct);
        var badProgress   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NOT NULL AND TRY_CAST(REPLACE(CAST(over_all_progress_percentages AS NVARCHAR(50)),'%','') AS FLOAT) IS NULL", ct);
        var progressOver1 = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND TRY_CAST(REPLACE(CAST(over_all_progress_percentages AS NVARCHAR(50)),'%','') AS FLOAT) > 1.0", ct);
        var multiName     = await Count(conn, "SELECT COUNT(*) FROM (SELECT pdo_well_id, COUNT(DISTINCT well_name_after_spud) c FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND well_name_after_spud IS NOT NULL AND well_name_after_spud<>'' GROUP BY pdo_well_id HAVING COUNT(DISTINCT well_name_after_spud)>1) x", ct);
        var dupWellWeek   = await Count(conn, "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        var orphanWells   = await Count(conn, "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' AND NOT EXISTS(SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100))=w.project_id)", ct);
        var latestWeek    = await Scalar(conn, "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int days = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw) ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(days, 7, 28);
        double completeness  = Rate(nullWellId + nullWellName + nullProgress, wmrTotal * 3);
        double validity      = Rate(badProgress, wmrTotal);
        double consistency   = Rate(progressOver1 + multiName, distinctWells * 2);
        double integrity     = Rate(dupWellWeek + orphanWells, wmrTotal + distinctWells);
        double wmrScore      = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));
        var wmrIssues = new List<object>();
        if (nullWellId > 0)    wmrIssues.Add(Issue("pdo_well_id", $"{nullWellId} rows have NULL/empty pdo_well_id — excluded from drill-down.", "Completeness", "High", nullWellId));
        if (nullWellName > 0)  wmrIssues.Add(Issue("well_name_after_spud", $"{nullWellName} wells have no name — drill-down shows only well ID.", "Completeness", "Low", nullWellName));
        if (nullProgress > 0)  wmrIssues.Add(Issue("over_all_progress_percentages", $"{nullProgress} wells have NULL progress — shown as 0%.", "Completeness", "Medium", nullProgress));
        if (badProgress > 0)   wmrIssues.Add(Issue("over_all_progress_percentages", $"{badProgress} rows have unrecognisable progress format — shown as 0%.", "Validity", "High", badProgress));
        if (progressOver1 > 0) wmrIssues.Add(Issue("over_all_progress_percentages", $"{progressOver1} wells have MAX progress > 1.0 — bar inflated beyond 100%.", "Consistency", "High", progressOver1));
        if (multiName > 0)     wmrIssues.Add(Issue("well_name_after_spud", $"{multiName} wells have more than one distinct name across snapshots.", "Consistency", "Low", multiName));
        if (dupWellWeek > 0)   wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (pdo_well_id, Week_Number) pairs.", "Integrity", "Medium", dupWellWeek));
        if (orphanWells > 0)   wmrIssues.Add(Issue("project_id", $"{orphanWells} wells match no ProjectIDs row — excluded from cluster drill-down.", "Integrity", "High", orphanWells));
        if (days > 7)          wmrIssues.Add(Issue("Week_Number", $"Latest snapshot is {days} days old ({latestWeek}) — progress bars may be stale.", "Freshness", days > 14 ? "High" : "Medium", days));
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        var pidNullType  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Type] IS NULL OR LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200))))=''", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullClust + pidNullType, pidTotal * 2), 1.0, 1.0, Rate(orphanWells, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullClust + pidNullType, pidTotal * 2), Rate(orphanWells, Math.Max(distinctWells, 1))));
        var pidIssues = new List<object>();
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — wells absent from every cluster drill-down.", "Completeness", "High", pidNullClust));
        if (pidNullType > 0)  pidIssues.Add(Issue("Type", $"{pidNullType} rows have NULL/empty Type — those wells never match a WellType filter.", "Completeness", "Low", pidNullType));
        if (orphanWells > 0) pidIssues.Add(Issue("ID (join type)", $"{orphanWells} WMR wells match no ProjectIDs.ID — no FK constraint enforces this join; those wells are excluded from cluster drill-down.", "Integrity", "High", orphanWells));
        double overall = wmrScore * 0.70 + pidScore * 0.30;
        return BuildResponse("clusterWellProgress",
            "Cluster Well Progress (Layer 2 — per-well drill-down). Sources: dbo.WMR + dbo.ProjectIDs.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",        totalRows = wmrTotal,  reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.ProjectIDs", totalRows = pidTotal,  reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // Construction Progress — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityConstructionProgress(CancellationToken ct)
    {
        await using var conn = Open();

        // ── dbo.WMR ──────────────────────────────────────────────────────────
        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness
        var nullWellId  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullWeek    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE Week_Number IS NULL OR Week_Number=''", ct);
        var nullFlConst = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND [overall_const._10_100] IS NULL", ct);
        var nullOhlProg = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND [overall_ohl_progr_100] IS NULL", ct);

        // Validity — unparseable progress / date fields
        var badFlConst  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE [overall_const._10_100] IS NOT NULL AND TRY_CAST([overall_const._10_100] AS FLOAT) IS NULL", ct);
        var badOhlProg  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE [overall_ohl_progr_100] IS NOT NULL AND TRY_CAST([overall_ohl_progr_100] AS FLOAT) IS NULL", ct);
        var badFlafDate = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(flaf_issue_date AS NVARCHAR(100))))<>'' AND TRY_CAST(flaf_issue_date AS DATE) IS NULL", ct);
        var badScrDate  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE scr_date IS NOT NULL AND LTRIM(RTRIM(CAST(scr_date AS NVARCHAR(100))))<>'' AND TRY_CAST(scr_date AS DATE) IS NULL", ct);

        // Consistency — mixed Week_Number format + wells with no SAP plan entry
        var weekShortFmt = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLongFmt  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var noSapMatch   = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        // Integrity — duplicate well+week, multi-project
        var dupWellWeek  = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        var multiProject = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);

        // Freshness
        var latestWeek   = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSince = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSince, 7, 28);

        var (wmrStructPenalty, wmrStructIssues) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double completeness = Rate(nullWellId + nullWeek + nullFlConst + nullOhlProg, wmrTotal * 4);
        double validity     = Rate(badFlConst + badOhlProg + badFlafDate + badScrDate, wmrTotal * 4);
        double consistency  = Rate(
            (weekShortFmt > 0 && weekLongFmt > 0 ? Math.Min(weekShortFmt, weekLongFmt) : 0) + noSapMatch,
            wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + multiProject + wmrStructPenalty, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullWellId > 0)  wmrIssues.Add(Issue("pdo_well_id",          $"{nullWellId} rows have NULL/empty pdo_well_id — excluded from all plan vs actual counts", "Completeness", "High", nullWellId));
        if (nullWeek > 0)    wmrIssues.Add(Issue("Week_Number",           $"{nullWeek} rows have NULL Week_Number — excluded from all date-filtered snapshots", "Completeness", "High", nullWeek));
        if (nullFlConst > 0) wmrIssues.Add(Issue("overall_const._10_100", $"{nullFlConst} wells have NULL FL construction progress — cannot be classified as FL Completed", "Completeness", "Medium", nullFlConst));
        if (nullOhlProg > 0) wmrIssues.Add(Issue("overall_ohl_progr_100", $"{nullOhlProg} wells have NULL OHL progress — cannot be classified as OHL Completed", "Completeness", "Medium", nullOhlProg));
        if (badFlConst > 0)  wmrIssues.Add(Issue("overall_const._10_100", $"{badFlConst} rows have a non-numeric FL construction progress value — TRY_CAST returns NULL, treated as 0%", "Validity", "High", badFlConst));
        if (badOhlProg > 0)  wmrIssues.Add(Issue("overall_ohl_progr_100", $"{badOhlProg} rows have a non-numeric OHL progress value — TRY_CAST returns NULL, treated as 0%", "Validity", "High", badOhlProg));
        if (badFlafDate > 0) wmrIssues.Add(Issue("flaf_issue_date",       $"{badFlafDate} rows have an unparseable FLAF date — excluded from FLAF-to-plan offset calculation", "Validity", "Medium", badFlafDate));
        if (badScrDate > 0)  wmrIssues.Add(Issue("scr_date",              $"{badScrDate} rows have an unparseable SCR date — excluded from SCR delay classification", "Validity", "Medium", badScrDate));
        if (weekShortFmt > 0 && weekLongFmt > 0) wmrIssues.Add(Issue("Week_Number", $"{weekShortFmt} rows use YY-MM-DD (8-char) and {weekLongFmt} rows use YYYY-MM-DD (10-char) — a COALESCE workaround handles both, but the mixed format is a data-entry quality issue", "Consistency", "High", weekShortFmt + weekLongFmt));
        if (noSapMatch > 0)  wmrIssues.Add(Issue("pdo_well_id",           $"{noSapMatch} WMR wells have no matching SAP_DRILLING_SEQUENCE_History row — plan start date is NULL, excluding them from the Plan count", "Consistency", "High", noSapMatch));
        if (dupWellWeek > 0) wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} (pdo_well_id, Week_Number) pairs have more than one row — ROW_NUMBER dedup picks one arbitrarily; FL/OHL completion status depends on which row wins the sort", "Integrity", "High", dupWellWeek));
        if (multiProject > 0)wmrIssues.Add(Issue("pdo_well_id / project_id", $"{multiProject} wells appear under more than one project_id — same well may be counted in multiple cluster/project views", "Integrity", "High", multiProject));
        if (daysSince > 7)   wmrIssues.Add(Issue("Week_Number",           $"Latest WMR snapshot is {daysSince} days old ({latestWeek}) — FL/OHL completion counts may not reflect current week activity", "Freshness", daysSince > 14 ? "High" : "Medium", daysSince));
        wmrIssues.AddRange(wmrStructIssues);

        // ── dbo.SAP_DRILLING_SEQUENCE_History ─────────────────────────────────
        var sapTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapNullStart  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NULL OR LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))=''", ct);
        var sapNullEnd    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE EarliestEndDate IS NULL OR LTRIM(RTRIM(CAST(EarliestEndDate AS NVARCHAR(50))))=''", ct);
        var sapBadStart   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NOT NULL AND LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))<>'' AND TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var sapBadEnd     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE EarliestEndDate IS NOT NULL AND LTRIM(RTRIM(CAST(EarliestEndDate AS NVARCHAR(50))))<>'' AND TRY_CAST(EarliestEndDate AS DATE) IS NULL", ct);
        var sapEndBefore  = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE TRY_CAST(EarliestEndDate AS DATE) IS NOT NULL AND TRY_CAST(Earl_start_date AS DATE) IS NOT NULL " +
            "AND TRY_CAST(EarliestEndDate AS DATE) < TRY_CAST(Earl_start_date AS DATE)", ct);
        var noWmrForSap   = await Count(conn,
            "SELECT COUNT(DISTINCT Well_ID) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE Well_ID IS NOT NULL AND Well_ID<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=Well_ID)", ct);

        var (sapStructPenalty, sapStructIssues) = await StructuralIntegrity(conn, "SAP_DRILLING_SEQUENCE_History", sapTotal, "Well_ID", "WMR.pdo_well_id", ct);
        double sapComplete = Rate(sapNullWellId + sapNullStart + sapNullEnd, sapTotal * 3);
        double sapValid    = Rate(sapBadStart + sapBadEnd + sapEndBefore, sapTotal * 3);
        double sapConsist  = Rate(noWmrForSap, Math.Max(distinctWells + sapNullWellId, 1));
        double sapInteg    = Rate(sapStructPenalty, sapTotal);
        double sapScore    = NaScore(sapTotal, ApplyGate(WeightedScore(sapComplete, sapValid, sapConsist, sapInteg, 1.0), sapComplete, sapInteg));

        var sapIssues = new List<object>();
        if (sapNullWellId > 0) sapIssues.Add(Issue("Well_ID",         $"{sapNullWellId} SAP rows have NULL/empty Well_ID — cannot be joined to WMR; those plan entries are excluded from the Plan count", "Completeness", "High", sapNullWellId));
        if (sapNullStart > 0)  sapIssues.Add(Issue("Earl_start_date", $"{sapNullStart} SAP rows have NULL/empty plan start date — those wells cannot be placed in a plan month, excluded from Plan count", "Completeness", "High", sapNullStart));
        if (sapNullEnd > 0)    sapIssues.Add(Issue("EarliestEndDate", $"{sapNullEnd} SAP rows have NULL/empty plan end date", "Completeness", "Medium", sapNullEnd));
        if (sapBadStart > 0)   sapIssues.Add(Issue("Earl_start_date", $"{sapBadStart} SAP rows have a non-parseable plan start date — TRY_CAST returns NULL, well excluded from Plan count", "Validity", "High", sapBadStart));
        if (sapBadEnd > 0)     sapIssues.Add(Issue("EarliestEndDate", $"{sapBadEnd} SAP rows have a non-parseable plan end date", "Validity", "Medium", sapBadEnd));
        if (sapEndBefore > 0)  sapIssues.Add(Issue("Earl_start_date / EarliestEndDate", $"{sapEndBefore} SAP rows have plan end before plan start — logically inconsistent well schedule", "Validity", "High", sapEndBefore));
        if (noWmrForSap > 0)   sapIssues.Add(Issue("Well_ID",         $"{noWmrForSap} SAP plan wells have no WMR tracking row — they appear in Plan count but never in Actual count, inflating the backlog", "Consistency", "High", noWmrForSap));
        sapIssues.AddRange(sapStructIssues);

        // ── dbo.ProjectIDs ────────────────────────────────────────────────────
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0, 1.0, Rate(noSapMatch, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0));

        var pidIssues = new List<object>();
        if (pidNullId > 0)    pidIssues.Add(Issue("ID",      $"{pidNullId} rows have NULL ID — cannot be matched to WMR.project_id; those project records are effectively invisible", "Completeness", "High", pidNullId));
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — wells in these projects are excluded from cluster-filtered construction progress views", "Completeness", "Medium", pidNullClust));

        // Overall weighted across three tables
        double overall = wmrScore * 0.55 + sapScore * 0.35 + pidScore * 0.10;

        return BuildResponse("constructionProgress",
            "Flowline & OHL Construction Progress — Plan vs Actual FL+OHL completion for the current year. " +
            "Primary source: dbo.WMR (weekly snapshots — FL/OHL completion flags derived from overall_const._10_100, " +
            "overall_ohl_progr_100, flow_line_const._status_in_progress_completed, ohl_completion_date). " +
            "Plan source: dbo.SAP_DRILLING_SEQUENCE_History (Earl_start_date determines plan month). " +
            "Filters: dbo.ProjectIDs (cluster / project / well-type scoping).",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal, reliabilityScore = Math.Round(sapScore, 1), reliabilityLabel = Label(sapScore), issues = sapIssues },
                new { table = "dbo.ProjectIDs",                    totalRows = pidTotal, reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATA_RULES — persist dynamically generated validation rules
    // ═══════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// POST /data-quality/rules — Save a new validation rule to DATA_RULES.
    /// Expects: category, ruleName, table, severity, query.
    /// Auto-generates RULE_ID (R01, R02, ...) and sets ACTIVE_YN = 'Y'.
    /// </summary>
    [HttpPost("rules")]
    public async Task<IActionResult> CreateRule(
        [FromBody] CreateRuleRequest request,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Category))
            return BadRequest("Category is required.");
        if (string.IsNullOrWhiteSpace(request.RuleName))
            return BadRequest("RuleName is required.");
        if (string.IsNullOrWhiteSpace(request.Table))
            return BadRequest("Table is required.");
        if (string.IsNullOrWhiteSpace(request.Severity))
            return BadRequest("Severity is required.");
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest("Query is required.");

        await using var conn = Open();

        // Get next RULE_ID
        const string nextIdSql = @"
            SELECT ISNULL(MAX(CAST(SUBSTRING(RULE_ID, 2, LEN(RULE_ID)-1) AS INT)), 0) + 1
            FROM dbo.DATA_RULES
            WHERE RULE_ID LIKE 'R%'
              AND ISNUMERIC(SUBSTRING(RULE_ID, 2, LEN(RULE_ID)-1)) = 1;";

        int nextNum;
        await using (var cmdNext = new SqlCommand(nextIdSql, conn) { CommandTimeout = 30 })
        {
            var val = await cmdNext.ExecuteScalarAsync(ct);
            nextNum = val is null || val == DBNull.Value ? 1 : Convert.ToInt32(val);
        }
        var ruleId = $"R{nextNum:D2}";

        // Calculate START_DATE and END_DATE from validation period
        var (startDate, endDate) = CalculateDateRange(request.ValidationPeriod, request.CustomStartDate, request.CustomEndDate);

        // Insert the rule
        const string insertSql = @"
            INSERT INTO dbo.DATA_RULES (RULE_ID, CATEGORY, RULE_NAME, [TABLE], SEVERITY, ACTIVE_YN, QUERY, MAX_RECORDS, START_DATE, END_DATE, PRIMARY_FIELD, FIELDS)
            VALUES (@RuleId, @Category, @RuleName, @Table, @Severity, 'Y', @Query, @MaxRecords, @StartDate, @EndDate, @PrimaryField, @Fields);";

        await using var cmdInsert = new SqlCommand(insertSql, conn) { CommandTimeout = 30 };
        cmdInsert.Parameters.AddWithValue("@RuleId", ruleId);
        cmdInsert.Parameters.AddWithValue("@Category", request.Category);
        cmdInsert.Parameters.AddWithValue("@RuleName", request.RuleName);
        cmdInsert.Parameters.AddWithValue("@Table", request.Table);
        cmdInsert.Parameters.AddWithValue("@Severity", request.Severity);
        cmdInsert.Parameters.AddWithValue("@Query", request.Query);
        cmdInsert.Parameters.AddWithValue("@MaxRecords", request.MaxRecords ?? 10);
        cmdInsert.Parameters.AddWithValue("@StartDate", (object?)startDate ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@EndDate", (object?)endDate ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@PrimaryField", (object?)request.PrimaryField ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@Fields", (object?)request.Fields ?? DBNull.Value);

        await cmdInsert.ExecuteNonQueryAsync(ct);

        return Ok(new { ruleId, message = "Rule created successfully.", activeYn = "Y" });
    }

    /// <summary>
    /// GET /data-quality/rules — List all saved validation rules.
    /// </summary>
    [HttpGet("rules")]
    public async Task<IActionResult> ListRules(CancellationToken ct = default)
    {
        await using var conn = Open();

        const string sql = @"
            SELECT RULE_ID, CATEGORY, RULE_NAME, [TABLE], SEVERITY, ACTIVE_YN, QUERY, MAX_RECORDS, START_DATE, END_DATE, PRIMARY_FIELD, TRIGGERED_ON, FIELDS
            FROM dbo.DATA_RULES
            ORDER BY RULE_ID;";

        var rules = new List<object>();
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rules.Add(new
            {
                ruleId = reader.GetString(0),
                category = reader.GetString(1),
                ruleName = reader.GetString(2),
                table = reader.GetString(3),
                severity = reader.GetString(4),
                activeYn = reader.GetString(5),
                query = reader.GetString(6),
                maxRecords = reader.IsDBNull(7) ? 10 : reader.GetInt32(7),
                startDate = reader.IsDBNull(8) ? (string?)null : reader.GetDateTime(8).ToString("yyyy-MM-dd"),
                endDate = reader.IsDBNull(9) ? (string?)null : reader.GetDateTime(9).ToString("yyyy-MM-dd"),
                primaryField = reader.IsDBNull(10) ? (string?)null : reader.GetString(10),
                triggeredOn = reader.IsDBNull(11) ? (string?)null : reader.GetDateTime(11).ToString("yyyy-MM-dd HH:mm"),
                fields = reader.IsDBNull(12) ? (string?)null : reader.GetString(12)
            });
        }

        return Ok(new { rules });
    }

    /// <summary>
    /// PATCH /data-quality/rules/{ruleId}/active — Toggle ACTIVE_YN for a rule.
    /// Body: { "activeYn": "Y" } or { "activeYn": "N" }
    /// </summary>
    [HttpPatch("rules/{ruleId}/active")]
    public async Task<IActionResult> ToggleRuleActive(
        string ruleId,
        [FromBody] ToggleActiveRequest request,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ruleId))
            return BadRequest("RuleId is required.");

        var val = request.ActiveYn?.Trim().ToUpperInvariant();
        if (val is not ("Y" or "N"))
            return BadRequest("activeYn must be 'Y' or 'N'.");

        await using var conn = Open();

        const string sql = @"
            UPDATE dbo.DATA_RULES
            SET ACTIVE_YN = @ActiveYn
            WHERE RULE_ID = @RuleId;";

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        cmd.Parameters.AddWithValue("@ActiveYn", val);
        cmd.Parameters.AddWithValue("@RuleId", ruleId);

        var rows = await cmd.ExecuteNonQueryAsync(ct);
        if (rows == 0)
            return NotFound(new { message = $"Rule '{ruleId}' not found." });

        return Ok(new { ruleId, activeYn = val, message = "Active status updated." });
    }

    /// <summary>
    /// PUT /data-quality/rules/{ruleId} — Update an existing validation rule.
    /// Preserves RULE_ID and ACTIVE_YN; updates all other fields.
    /// </summary>
    [HttpPut("rules/{ruleId}")]
    public async Task<IActionResult> UpdateRule(
        string ruleId,
        [FromBody] CreateRuleRequest request,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ruleId))
            return BadRequest("RuleId is required.");
        if (string.IsNullOrWhiteSpace(request.Category))
            return BadRequest("Category is required.");
        if (string.IsNullOrWhiteSpace(request.RuleName))
            return BadRequest("RuleName is required.");
        if (string.IsNullOrWhiteSpace(request.Table))
            return BadRequest("Table is required.");
        if (string.IsNullOrWhiteSpace(request.Severity))
            return BadRequest("Severity is required.");
        if (string.IsNullOrWhiteSpace(request.Query))
            return BadRequest("Query is required.");

        await using var conn = Open();

        // Calculate START_DATE and END_DATE from validation period
        var (startDate, endDate) = CalculateDateRange(request.ValidationPeriod, request.CustomStartDate, request.CustomEndDate);

        const string sql = @"
            UPDATE dbo.DATA_RULES
            SET CATEGORY  = @Category,
                RULE_NAME = @RuleName,
                [TABLE]   = @Table,
                SEVERITY  = @Severity,
                QUERY     = @Query,
                MAX_RECORDS = @MaxRecords,
                START_DATE = @StartDate,
                END_DATE = @EndDate,
                PRIMARY_FIELD = @PrimaryField,
                FIELDS = @Fields
            WHERE RULE_ID = @RuleId;";

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        cmd.Parameters.AddWithValue("@RuleId", ruleId);
        cmd.Parameters.AddWithValue("@Category", request.Category);
        cmd.Parameters.AddWithValue("@RuleName", request.RuleName);
        cmd.Parameters.AddWithValue("@Table", request.Table);
        cmd.Parameters.AddWithValue("@Severity", request.Severity);
        cmd.Parameters.AddWithValue("@Query", request.Query);
        cmd.Parameters.AddWithValue("@MaxRecords", request.MaxRecords ?? 10);
        cmd.Parameters.AddWithValue("@StartDate", (object?)startDate ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@EndDate", (object?)endDate ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@PrimaryField", (object?)request.PrimaryField ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Fields", (object?)request.Fields ?? DBNull.Value);

        var rows = await cmd.ExecuteNonQueryAsync(ct);
        if (rows == 0)
            return NotFound(new { message = $"Rule '{ruleId}' not found." });

        return Ok(new { ruleId, message = "Rule updated successfully." });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Manual Trigger – execute a rule's query and populate ERROR_LOG
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("rules/{ruleId}/execute")]
    public async Task<IActionResult> ExecuteRule(string ruleId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ruleId))
            return BadRequest("RuleId is required.");

        await using var conn = Open();

        // Fetch the rule (including PRIMARY_FIELD)
        const string fetchSql = @"
            SELECT RULE_NAME, SEVERITY, QUERY, MAX_RECORDS, PRIMARY_FIELD, CATEGORY, FIELDS
            FROM dbo.DATA_RULES
            WHERE RULE_ID = @RuleId;";
        string? ruleName = null, severity = null, query = null, primaryFieldCsv = null, category = null, fields = null;
        int maxRecords = 10;

        await using (var fetchCmd = new SqlCommand(fetchSql, conn) { CommandTimeout = 30 })
        {
            fetchCmd.Parameters.AddWithValue("@RuleId", ruleId);
            await using var reader = await fetchCmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return NotFound(new { message = $"Rule '{ruleId}' not found." });
            ruleName = reader.GetString(0);
            severity = reader.GetString(1);
            query = reader.IsDBNull(2) ? null : reader.GetString(2);
            maxRecords = reader.IsDBNull(3) ? 10 : reader.GetInt32(3);
            primaryFieldCsv = reader.IsDBNull(4) ? null : reader.GetString(4);
            category = reader.IsDBNull(5) ? null : reader.GetString(5);
            fields = reader.IsDBNull(6) ? null : reader.GetString(6);
        }

        if (string.IsNullOrWhiteSpace(query))
            return BadRequest(new { message = "Rule has no stored query." });

        // Parse primary key column names from the comma-separated PRIMARY_FIELD
        var pkColumns = (primaryFieldCsv ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        // Execute the rule's validation query
        List<Dictionary<string, object?>> results;
        try
        {
            await using var execCmd = new SqlCommand(query, conn) { CommandTimeout = 120 };
            await using var execReader = await execCmd.ExecuteReaderAsync(ct);
            results = new List<Dictionary<string, object?>>();
            var fieldNames = new List<string>();
            for (int i = 0; i < execReader.FieldCount; i++)
                fieldNames.Add(execReader.GetName(i));

            while (await execReader.ReadAsync(ct) && results.Count < maxRecords)
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < execReader.FieldCount; i++)
                    row[fieldNames[i]] = execReader.IsDBNull(i) ? null : execReader.GetValue(i);
                results.Add(row);
            }
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = "Query execution failed.", error = ex.Message });
        }

        if (results.Count == 0)
            return Ok(new { ruleId, message = "Validation rule executed successfully. No issues found.", inserted = 0, total = 0 });

        // Determine well column from results
        string[] wellCandidates = ["Well", "WellID", "Well_ID", "WELL_ID", "well", "wellid", "well_id", "WELL"];
        string? wellColumnName = null;
        var firstRow = results[0];
        foreach (var candidate in wellCandidates)
        {
            if (firstRow.ContainsKey(candidate))
            {
                wellColumnName = candidate;
                break;
            }
        }

        // Build a helper to extract the composite PK value string from a result row
        string GetPrimaryKeyValue(Dictionary<string, object?> row)
        {
            if (pkColumns.Count == 0) return "";
            var parts = new List<string>();
            foreach (var pk in pkColumns)
            {
                // Strip square brackets if present
                var cleanPk = pk.TrimStart('[').TrimEnd(']');
                if (row.TryGetValue(cleanPk, out var val) && val != null)
                    parts.Add(val.ToString()!);
                else
                    parts.Add("");
            }
            return string.Join("|", parts);
        }

        // Insert into ERROR_LOG with duplicate checking
        // Duplicate detection only applies when PK values are available and non-empty.
        // When no PK is available (table has no PK, or PK not in query), every row is inserted.
        int inserted = 0;
        foreach (var row in results)
        {
            string? wellValue = null;
            if (wellColumnName != null && row.TryGetValue(wellColumnName, out var wv) && wv != null)
                wellValue = wv.ToString();

            var pkValue = GetPrimaryKeyValue(row);

            // Only check for duplicates when we have a meaningful PK value
            if (!string.IsNullOrEmpty(pkValue))
            {
                const string dupCheck = @"
                    SELECT COUNT(1) FROM dbo.ERROR_LOG
                    WHERE RULE_ID = @RuleId
                      AND STATUS = 'Open'
                      AND PRIMARY_FIELD = @PrimaryField;";
                await using (var dupCmd = new SqlCommand(dupCheck, conn) { CommandTimeout = 15 })
                {
                    dupCmd.Parameters.AddWithValue("@RuleId", ruleId);
                    dupCmd.Parameters.AddWithValue("@PrimaryField", pkValue);
                    var dupCount = Convert.ToInt64(await dupCmd.ExecuteScalarAsync(ct));
                    if (dupCount > 0) continue;
                }
            }

            // Generate next ERROR_ID (E01, E02, ...)
            const string nextErrIdSql = @"
                SELECT ISNULL(MAX(CAST(SUBSTRING(ERROR_ID, 2, LEN(ERROR_ID)-1) AS INT)), 0) + 1
                FROM dbo.ERROR_LOG
                WHERE ERROR_ID LIKE 'E%'
                  AND ISNUMERIC(SUBSTRING(ERROR_ID, 2, LEN(ERROR_ID)-1)) = 1;";
            int nextErrNum;
            await using (var nextErrCmd = new SqlCommand(nextErrIdSql, conn) { CommandTimeout = 15 })
            {
                var nv = await nextErrCmd.ExecuteScalarAsync(ct);
                nextErrNum = nv is null || nv == DBNull.Value ? 1 : Convert.ToInt32(nv);
            }
            var errorId = $"E{nextErrNum:D2}";

            const string insertSql = @"
                INSERT INTO dbo.ERROR_LOG (ERROR_ID, RULE_ID, SEVERITY, RULE_NAME, PRIMARY_FIELD, STATUS, WELL, SLA, CREATED_AT, CATEGORY, FIELDS)
                VALUES (@ErrorId, @RuleId, @Severity, @RuleName, @PrimaryField, 'Open', @Well, NULL, GETDATE(), @Category, @Fields);";
            await using var insertCmd = new SqlCommand(insertSql, conn) { CommandTimeout = 15 };
            insertCmd.Parameters.AddWithValue("@ErrorId", errorId);
            insertCmd.Parameters.AddWithValue("@RuleId", ruleId);
            insertCmd.Parameters.AddWithValue("@Severity", severity!);
            insertCmd.Parameters.AddWithValue("@RuleName", ruleName!);
            insertCmd.Parameters.AddWithValue("@PrimaryField", string.IsNullOrEmpty(pkValue) ? DBNull.Value : pkValue);
            insertCmd.Parameters.AddWithValue("@Well", (object?)wellValue ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("@Category", (object?)category ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("@Fields", (object?)fields ?? DBNull.Value);
            await insertCmd.ExecuteNonQueryAsync(ct);
            inserted++;
        }

        // Build appropriate message
        string message;
        if (inserted > 0)
            message = $"Validation rule executed successfully. {inserted} issues found.";
        else
            message = "Validation rule executed successfully. No new issues found.";

        // Update TRIGGERED_ON timestamp on successful execution
        const string updateTriggeredSql = @"
            UPDATE dbo.DATA_RULES SET TRIGGERED_ON = GETDATE() WHERE RULE_ID = @TriggeredRuleId;";
        await using (var trigCmd = new SqlCommand(updateTriggeredSql, conn) { CommandTimeout = 15 })
        {
            trigCmd.Parameters.AddWithValue("@TriggeredRuleId", ruleId);
            await trigCmd.ExecuteNonQueryAsync(ct);
        }

        return Ok(new { ruleId, message, inserted, total = results.Count });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Open Errors — list & update (reads from ERROR_LOG)
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>GET /data-quality/open-errors — List all open error records from ERROR_LOG.</summary>
    [HttpGet("open-errors")]
    public async Task<IActionResult> ListOpenErrors(CancellationToken ct = default)
    {
        await using var conn = Open();

        const string sql = @"
            SELECT e.ERROR_ID, e.RULE_ID, e.SEVERITY, e.RULE_NAME, e.PRIMARY_FIELD, e.STATUS, e.WELL, e.SLA, e.CREATED_AT, e.CHANGED_BY, e.CATEGORY, ISNULL(e.FIELDS, r.FIELDS) AS FIELDS
            FROM dbo.ERROR_LOG e
            LEFT JOIN dbo.DATA_RULES r ON r.RULE_ID = e.RULE_ID
            ORDER BY e.CREATED_AT DESC;";

        var errors = new List<object>();
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            errors.Add(new
            {
                errorId = reader.GetString(0),
                ruleId = reader.GetString(1),
                severity = reader.IsDBNull(2) ? (string?)null : reader.GetString(2),
                ruleName = reader.IsDBNull(3) ? (string?)null : reader.GetString(3),
                primaryField = reader.IsDBNull(4) ? (string?)null : reader.GetString(4),
                status = reader.IsDBNull(5) ? "Open" : reader.GetString(5),
                well = reader.IsDBNull(6) ? (string?)null : reader.GetString(6),
                sla = reader.IsDBNull(7) ? (string?)null : reader.GetString(7),
                createdAt = reader.IsDBNull(8) ? (string?)null : reader.GetDateTime(8).ToString("yyyy-MM-dd HH:mm"),
                changedBy = reader.IsDBNull(9) ? (string?)null : reader.GetString(9),
                category = reader.IsDBNull(10) ? (string?)null : reader.GetString(10),
                fields = reader.IsDBNull(11) ? (string?)null : reader.GetString(11)
            });
        }

        return Ok(new { errors });
    }

    /// <summary>PATCH /data-quality/open-errors/{errorId}/action — Update the action for an open error.</summary>
    [HttpPatch("open-errors/{errorId}/action")]
    public async Task<IActionResult> UpdateErrorAction(
        string errorId,
        [FromBody] UpdateActionRequest request,
        CancellationToken ct = default)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "Open", "Close", "In Progress", "On Hold", "Invalid" };
        var val = request.Action?.Trim();
        if (string.IsNullOrWhiteSpace(val) || !allowed.Contains(val))
            return BadRequest("Action must be one of: Open, Close, In Progress, On Hold, Invalid.");

        var changedBy = request.ChangedBy?.Trim();

        await using var conn = Open();
        const string sql = @"
            UPDATE dbo.ERROR_LOG SET STATUS = @Action, CHANGED_BY = @ChangedBy WHERE ERROR_ID = @ErrorId;";
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 15 };
        cmd.Parameters.AddWithValue("@Action", val);
        cmd.Parameters.AddWithValue("@ChangedBy", (object?)changedBy ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ErrorId", errorId);
        var rows = await cmd.ExecuteNonQueryAsync(ct);
        if (rows == 0)
            return NotFound(new { message = $"Error record {errorId} not found." });
        return Ok(new { errorId, action = val, changedBy, message = "Action updated." });
    }

    /// <summary>PATCH /data-quality/open-errors/{errorId}/status — Update the status for an open error.</summary>
    [HttpPatch("open-errors/{errorId}/status")]
    public async Task<IActionResult> UpdateErrorStatus(
        string errorId,
        [FromBody] UpdateStatusRequest request,
        CancellationToken ct = default)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "Open", "Close", "In Progress", "On Hold", "Invalid" };
        var val = request.Status?.Trim();
        if (string.IsNullOrWhiteSpace(val) || !allowed.Contains(val))
            return BadRequest("Status must be one of: Open, Close, In Progress, On Hold, Invalid.");

        var changedBy = request.ChangedBy?.Trim();

        await using var conn = Open();
        const string sql = @"
            UPDATE dbo.ERROR_LOG SET STATUS = @Status, CHANGED_BY = @ChangedBy WHERE ERROR_ID = @ErrorId;";
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 15 };
        cmd.Parameters.AddWithValue("@Status", val);
        cmd.Parameters.AddWithValue("@ChangedBy", (object?)changedBy ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ErrorId", errorId);
        var rows = await cmd.ExecuteNonQueryAsync(ct);
        if (rows == 0)
            return NotFound(new { message = $"Error record {errorId} not found." });
        return Ok(new { errorId, status = val, changedBy, message = "Status updated." });
    }

    public sealed record UpdateActionRequest(string? Action, string? ChangedBy);
    public sealed record UpdateStatusRequest(string? Status, string? ChangedBy);

    public sealed record CreateRuleRequest(
        string? Category,
        string? RuleName,
        string? Table,
        string? Severity,
        string? Query,
        string? ValidationPeriod,
        int? MaxRecords,
        string? CustomStartDate,
        string? CustomEndDate,
        string? PrimaryField,
        string? Fields);

    public sealed record ToggleActiveRequest(string? ActiveYn);

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: calculate START_DATE / END_DATE from Validation Period
    // ─────────────────────────────────────────────────────────────────────────
    private static (string? startDate, string? endDate) CalculateDateRange(
        string? validationPeriod,
        string? customStart,
        string? customEnd)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);

        return validationPeriod switch
        {
            "Today" => (today.ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Week" => (today.AddDays(-7).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Last Week" => (today.AddDays(-14).ToString("yyyy-MM-dd"), today.AddDays(-7).ToString("yyyy-MM-dd")),
            "Last 30 Days" => (today.AddDays(-30).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Last 60 Days" => (today.AddDays(-60).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Last 90 Days" => (today.AddDays(-90).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Last 120 Days" => (today.AddDays(-120).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Year" => (new DateOnly(today.Year, 1, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Last Year" => (new DateOnly(today.Year - 1, 1, 1).ToString("yyyy-MM-dd"), new DateOnly(today.Year - 1, 12, 31).ToString("yyyy-MM-dd")),
            "Custom" => (customStart, customEnd),
            _ => (today.AddDays(-7).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")) // default: This Week
        };
    }

    // =========================================================================
    // 14. WRO OVERALL (Overall1 tab) — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History
    //     + dbo.ProjectIDs + dbo.WellMonitoringReport_Latest (PDO issues)
    // =========================================================================
    private async Task<object> QualityWroOverall(CancellationToken ct)
    {
        await using var conn = Open();

        // ── dbo.WMR ──────────────────────────────────────────────────────────
        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness
        var nullWellId   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullWeek     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE Week_Number IS NULL OR Week_Number=''", ct);
        var nullProgress = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND over_all_progress_percentages IS NULL", ct);
        var nullFlaf     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND flaf_issue_date IS NULL", ct);

        // Validity
        var badProgress  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE over_all_progress_percentages IS NOT NULL AND TRY_CAST(over_all_progress_percentages AS FLOAT) IS NULL", ct);
        var badFlafDate  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(flaf_issue_date AS NVARCHAR(100))))<>'' AND TRY_CAST(flaf_issue_date AS DATE) IS NULL", ct);
        var badScrDate   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE scr_date IS NOT NULL AND LTRIM(RTRIM(CAST(scr_date AS NVARCHAR(100))))<>'' AND TRY_CAST(scr_date AS DATE) IS NULL", ct);

        // Consistency
        var weekShort    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var noSapMatch   = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        // Integrity
        var dupWellWeek  = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);
        var multiProject = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,COUNT(DISTINCT project_id) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND project_id IS NOT NULL GROUP BY pdo_well_id HAVING COUNT(DISTINCT project_id)>1) x", ct);

        // Freshness
        var latestWeek   = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSince = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw)
            ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSince, 7, 28);

        var (wmrStructPenalty, wmrStructIssues) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double completeness = Rate(nullWellId + nullWeek + nullProgress + nullFlaf, wmrTotal * 4);
        double validity     = Rate(badProgress + badFlafDate + badScrDate, wmrTotal * 3);
        double consistency  = Rate((weekShort > 0 && weekLong > 0 ? Math.Min(weekShort, weekLong) : 0) + noSapMatch, wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + multiProject + wmrStructPenalty, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullWellId > 0)   wmrIssues.Add(Issue("pdo_well_id",                $"{nullWellId} rows have NULL/empty pdo_well_id — excluded from all funnel counts", "Completeness", "High", nullWellId));
        if (nullWeek > 0)     wmrIssues.Add(Issue("Week_Number",                $"{nullWeek} rows have NULL Week_Number — excluded from all date-filtered snapshots", "Completeness", "High", nullWeek));
        if (nullProgress > 0) wmrIssues.Add(Issue("over_all_progress_percentages", $"{nullProgress} wells have NULL progress — treated as 0%; may be incorrectly counted as Backlog", "Completeness", "Medium", nullProgress));
        if (nullFlaf > 0)     wmrIssues.Add(Issue("flaf_issue_date",            $"{nullFlaf} wells have no FLAF date — cannot be classified as FLAF/SCR-delayed; those wells remain in the Clean Target count", "Completeness", "Medium", nullFlaf));
        if (badProgress > 0)  wmrIssues.Add(Issue("over_all_progress_percentages", $"{badProgress} rows have non-numeric progress — TRY_CAST returns NULL, treated as 0%", "Validity", "High", badProgress));
        if (badFlafDate > 0)  wmrIssues.Add(Issue("flaf_issue_date",            $"{badFlafDate} rows have unparseable FLAF date — excluded from FLAF/SCR classification", "Validity", "Medium", badFlafDate));
        if (badScrDate > 0)   wmrIssues.Add(Issue("scr_date",                  $"{badScrDate} rows have unparseable SCR date — excluded from FLAF/SCR classification", "Validity", "Medium", badScrDate));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number",  $"Mixed Week_Number format: {weekShort} rows use YY-MM-DD and {weekLong} use YYYY-MM-DD — COALESCE workaround applies; data-entry quality issue", "Consistency", "High", weekShort + weekLong));
        if (noSapMatch > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{noSapMatch} WMR wells have no SAP plan entry — those wells cannot appear in the Plan count and will always show as Backlog", "Consistency", "High", noSapMatch));
        if (dupWellWeek > 0)  wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (well, week) pairs — ROW_NUMBER picks one row arbitrarily; funnel classification depends on which row wins", "Integrity", "High", dupWellWeek));
        if (multiProject > 0) wmrIssues.Add(Issue("pdo_well_id / project_id",  $"{multiProject} wells appear under multiple project_ids — same well may be counted in multiple cluster/project funnel views", "Integrity", "High", multiProject));
        if (daysSince > 7)    wmrIssues.Add(Issue("Week_Number",               $"Latest WMR snapshot is {daysSince} days old ({latestWeek}) — funnel counts may not reflect current week", "Freshness", daysSince > 14 ? "High" : "Medium", daysSince));
        wmrIssues.AddRange(wmrStructIssues);

        // ── dbo.SAP_DRILLING_SEQUENCE_History ─────────────────────────────────
        var sapTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapNullStart  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NULL OR LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))=''", ct);
        var sapBadStart   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NOT NULL AND LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))<>'' AND TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var noWmrForSap   = await Count(conn,
            "SELECT COUNT(DISTINCT Well_ID) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE Well_ID IS NOT NULL AND Well_ID<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=Well_ID)", ct);
        var (sapStructPenalty, sapStructIssues) = await StructuralIntegrity(conn, "SAP_DRILLING_SEQUENCE_History", sapTotal, "Well_ID", "WMR.pdo_well_id", ct);
        double sapComplete = Rate(sapNullWellId + sapNullStart, sapTotal * 2);
        double sapValid    = Rate(sapBadStart, sapTotal);
        double sapConsist  = Rate(noWmrForSap, Math.Max(distinctWells + sapNullWellId, 1));
        double sapScore    = NaScore(sapTotal, ApplyGate(WeightedScore(sapComplete, sapValid, sapConsist, Rate(sapStructPenalty, sapTotal), 1.0), sapComplete, Rate(sapStructPenalty, sapTotal)));
        var sapIssues = new List<object>();
        if (sapNullWellId > 0) sapIssues.Add(Issue("Well_ID",         $"{sapNullWellId} SAP rows have NULL/empty Well_ID — cannot be joined to WMR; those plan entries are absent from the Plan count", "Completeness", "High", sapNullWellId));
        if (sapNullStart > 0)  sapIssues.Add(Issue("Earl_start_date", $"{sapNullStart} SAP rows have NULL/empty plan start date — those wells cannot be placed in the Plan month", "Completeness", "High", sapNullStart));
        if (sapBadStart > 0)   sapIssues.Add(Issue("Earl_start_date", $"{sapBadStart} SAP rows have non-parseable plan start date — TRY_CAST returns NULL, well excluded from Plan count", "Validity", "High", sapBadStart));
        if (noWmrForSap > 0)   sapIssues.Add(Issue("Well_ID",         $"{noWmrForSap} SAP plan wells have no WMR tracking row — appear in Plan count but never in Actual, inflating the Backlog", "Consistency", "High", noWmrForSap));
        sapIssues.AddRange(sapStructIssues);

        // ── dbo.ProjectIDs ────────────────────────────────────────────────────
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0, 1.0, Rate(noSapMatch, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullId + pidNullClust, pidTotal * 2), Rate(noSapMatch, Math.Max(distinctWells, 1))));
        var pidIssues = new List<object>();
        if (pidNullId > 0)    pidIssues.Add(Issue("ID",      $"{pidNullId} rows have NULL ID — cannot be matched to WMR.project_id; those project records are invisible to cluster/type filters", "Completeness", "High", pidNullId));
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — wells in these projects are excluded from cluster-filtered funnel views", "Completeness", "Medium", pidNullClust));

        double overall = wmrScore * 0.55 + sapScore * 0.35 + pidScore * 0.10;
        return BuildResponse("wroOverall",
            "Wells Readiness Overall Status — Plan-to-Actual funnel (Original Plan → After FLAF/SCR Removed → After PDO Issues → Actual Completed). " +
            "Primary source: dbo.WMR (latest weekly snapshot per well — progress, flaf_issue_date, scr_date). " +
            "Plan source: dbo.SAP_DRILLING_SEQUENCE_History (Earl_start_date determines plan month). " +
            "Filters: dbo.ProjectIDs (cluster / project / well-type scoping).",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal, reliabilityScore = Math.Round(sapScore, 1), reliabilityLabel = Label(sapScore), issues = sapIssues },
                new { table = "dbo.ProjectIDs",                    totalRows = pidTotal, reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // 15. WRO FLOWLINE — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityWroFlowline(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness — FL-specific fields
        var nullWellId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullWeek      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE Week_Number IS NULL OR Week_Number=''", ct);
        var nullFlConst   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND [overall_const._10_100] IS NULL", ct);
        var nullFlStatus  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND [flow_line_const._status_in_progress_completed] IS NULL", ct);
        var nullFlaf      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND flaf_issue_date IS NULL", ct);

        // Validity
        var badFlConst    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE [overall_const._10_100] IS NOT NULL AND TRY_CAST([overall_const._10_100] AS FLOAT) IS NULL", ct);
        var badFlafDate   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(flaf_issue_date AS NVARCHAR(100))))<>'' AND TRY_CAST(flaf_issue_date AS DATE) IS NULL", ct);

        // Consistency
        var weekShort     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var noSapMatch    = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        // Integrity
        var dupWellWeek   = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek    = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSince = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw2)
            ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw2.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSince, 7, 28);

        var (wmrStructPenalty, wmrStructIssues) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double completeness = Rate(nullWellId + nullWeek + nullFlConst + nullFlStatus + nullFlaf, wmrTotal * 5);
        double validity     = Rate(badFlConst + badFlafDate, wmrTotal * 2);
        double consistency  = Rate((weekShort > 0 && weekLong > 0 ? Math.Min(weekShort, weekLong) : 0) + noSapMatch, wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + wmrStructPenalty, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullWellId > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{nullWellId} rows have NULL/empty pdo_well_id — excluded from all FL completion counts", "Completeness", "High", nullWellId));
        if (nullWeek > 0)     wmrIssues.Add(Issue("Week_Number",               $"{nullWeek} rows have NULL Week_Number — excluded from all date-filtered FL snapshots", "Completeness", "High", nullWeek));
        if (nullFlConst > 0)  wmrIssues.Add(Issue("overall_const._10_100",     $"{nullFlConst} wells have NULL FL construction progress — cannot be classified as FL Completed", "Completeness", "High", nullFlConst));
        if (nullFlStatus > 0) wmrIssues.Add(Issue("flow_line_const._status_in_progress_completed", $"{nullFlStatus} wells have NULL FL status field — completion classification falls back to progress % only", "Completeness", "Medium", nullFlStatus));
        if (nullFlaf > 0)     wmrIssues.Add(Issue("flaf_issue_date",           $"{nullFlaf} wells have no FLAF date — cannot be removed from the Flowline Plan count as FLAF/SCR-delayed", "Completeness", "Medium", nullFlaf));
        if (badFlConst > 0)   wmrIssues.Add(Issue("overall_const._10_100",     $"{badFlConst} rows have non-numeric FL progress value — TRY_CAST returns NULL, treated as 0%", "Validity", "High", badFlConst));
        if (badFlafDate > 0)  wmrIssues.Add(Issue("flaf_issue_date",           $"{badFlafDate} rows have unparseable FLAF date — FLAF/SCR classification fails for those wells", "Validity", "Medium", badFlafDate));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number",  $"Mixed Week_Number format: {weekShort} rows use YY-MM-DD and {weekLong} use YYYY-MM-DD", "Consistency", "High", weekShort + weekLong));
        if (noSapMatch > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{noSapMatch} WMR wells have no SAP plan entry — cannot appear in the Flowline Plan count", "Consistency", "High", noSapMatch));
        if (dupWellWeek > 0)  wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (well, week) pairs — ROW_NUMBER picks one row arbitrarily; FL completion status depends on which row wins", "Integrity", "High", dupWellWeek));
        if (daysSince > 7)    wmrIssues.Add(Issue("Week_Number",               $"Latest WMR snapshot is {daysSince} days old ({latestWeek}) — FL completion counts may be stale", "Freshness", daysSince > 14 ? "High" : "Medium", daysSince));
        wmrIssues.AddRange(wmrStructIssues);

        // SAP
        var sapTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapNullStart  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NULL OR LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))=''", ct);
        var sapBadStart   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NOT NULL AND LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))<>'' AND TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var noWmrForSap   = await Count(conn,
            "SELECT COUNT(DISTINCT Well_ID) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE Well_ID IS NOT NULL AND Well_ID<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=Well_ID)", ct);
        var (sapStructPenalty, sapStructIssues) = await StructuralIntegrity(conn, "SAP_DRILLING_SEQUENCE_History", sapTotal, "Well_ID", "WMR.pdo_well_id", ct);
        double sapScore = NaScore(sapTotal, ApplyGate(WeightedScore(Rate(sapNullWellId + sapNullStart, sapTotal * 2), Rate(sapBadStart, sapTotal),
            Rate(noWmrForSap, Math.Max(distinctWells + sapNullWellId, 1)), Rate(sapStructPenalty, sapTotal), 1.0),
            Rate(sapNullWellId + sapNullStart, sapTotal * 2), Rate(sapStructPenalty, sapTotal)));
        var sapIssues = new List<object>();
        if (sapNullWellId > 0) sapIssues.Add(Issue("Well_ID",         $"{sapNullWellId} SAP rows have NULL/empty Well_ID — absent from FL Plan count", "Completeness", "High", sapNullWellId));
        if (sapNullStart > 0)  sapIssues.Add(Issue("Earl_start_date", $"{sapNullStart} SAP rows have NULL/empty plan start date — excluded from FL Plan month", "Completeness", "High", sapNullStart));
        if (sapBadStart > 0)   sapIssues.Add(Issue("Earl_start_date", $"{sapBadStart} SAP rows have non-parseable plan start date", "Validity", "High", sapBadStart));
        if (noWmrForSap > 0)   sapIssues.Add(Issue("Well_ID",         $"{noWmrForSap} SAP plan wells have no WMR tracking row — appear in Plan count but never in Actual, inflating FL Backlog", "Consistency", "High", noWmrForSap));
        sapIssues.AddRange(sapStructIssues);

        // ProjectIDs
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0, 1.0, Rate(noSapMatch, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullId + pidNullClust, pidTotal * 2), Rate(noSapMatch, Math.Max(distinctWells, 1))));
        var pidIssues = new List<object>();
        if (pidNullId > 0)    pidIssues.Add(Issue("ID",      $"{pidNullId} rows have NULL ID — invisible to cluster/type filters", "Completeness", "High", pidNullId));
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — wells excluded from cluster-filtered FL views", "Completeness", "Medium", pidNullClust));

        double overall = wmrScore * 0.55 + sapScore * 0.35 + pidScore * 0.10;
        return BuildResponse("wroFlowline",
            "Wells Readiness — Flowline tab. Plan-to-Actual Flowline completion funnel. " +
            "FL completion derived from: overall_const._10_100 (≥ 1.0) and flow_line_const._status_in_progress_completed. " +
            "FLAF/SCR classification from flaf_issue_date and scr_date. " +
            "Plan source: dbo.SAP_DRILLING_SEQUENCE_History.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal, reliabilityScore = Math.Round(sapScore, 1), reliabilityLabel = Label(sapScore), issues = sapIssues },
                new { table = "dbo.ProjectIDs",                    totalRows = pidTotal, reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // 16. WRO OHL — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityWroOhl(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness — OHL-specific fields
        var nullWellId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullWeek      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE Week_Number IS NULL OR Week_Number=''", ct);
        var nullOhlProg   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND [overall_ohl_progr_100] IS NULL", ct);
        var nullOhlComp   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND ohl_completion_date IS NULL", ct);
        var nullFlaf      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND flaf_issue_date IS NULL", ct);

        // Validity
        var badOhlProg    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE [overall_ohl_progr_100] IS NOT NULL AND TRY_CAST([overall_ohl_progr_100] AS FLOAT) IS NULL", ct);
        var badOhlDate    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE ohl_completion_date IS NOT NULL AND LTRIM(RTRIM(CAST(ohl_completion_date AS NVARCHAR(100))))<>'' AND TRY_CAST(ohl_completion_date AS DATE) IS NULL", ct);
        var badFlafDate   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(flaf_issue_date AS NVARCHAR(100))))<>'' AND TRY_CAST(flaf_issue_date AS DATE) IS NULL", ct);

        // Consistency
        var weekShort     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var noSapMatch    = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        // Integrity
        var dupWellWeek   = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek    = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSince = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw3)
            ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw3.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSince, 7, 28);

        var (wmrStructPenalty, wmrStructIssues) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double completeness = Rate(nullWellId + nullWeek + nullOhlProg + nullOhlComp + nullFlaf, wmrTotal * 5);
        double validity     = Rate(badOhlProg + badOhlDate + badFlafDate, wmrTotal * 3);
        double consistency  = Rate((weekShort > 0 && weekLong > 0 ? Math.Min(weekShort, weekLong) : 0) + noSapMatch, wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + wmrStructPenalty, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullWellId > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{nullWellId} rows have NULL/empty pdo_well_id — excluded from all OHL completion counts", "Completeness", "High", nullWellId));
        if (nullWeek > 0)     wmrIssues.Add(Issue("Week_Number",               $"{nullWeek} rows have NULL Week_Number — excluded from all date-filtered OHL snapshots", "Completeness", "High", nullWeek));
        if (nullOhlProg > 0)  wmrIssues.Add(Issue("overall_ohl_progr_100",     $"{nullOhlProg} wells have NULL OHL progress — cannot be classified as OHL Completed", "Completeness", "High", nullOhlProg));
        if (nullOhlComp > 0)  wmrIssues.Add(Issue("ohl_completion_date",       $"{nullOhlComp} wells have NULL OHL completion date — date-based OHL completion check cannot be applied", "Completeness", "Medium", nullOhlComp));
        if (nullFlaf > 0)     wmrIssues.Add(Issue("flaf_issue_date",           $"{nullFlaf} wells have no FLAF date — cannot be excluded from OHL Plan count as FLAF/SCR-delayed", "Completeness", "Medium", nullFlaf));
        if (badOhlProg > 0)   wmrIssues.Add(Issue("overall_ohl_progr_100",     $"{badOhlProg} rows have non-numeric OHL progress — TRY_CAST returns NULL, treated as 0%", "Validity", "High", badOhlProg));
        if (badOhlDate > 0)   wmrIssues.Add(Issue("ohl_completion_date",       $"{badOhlDate} rows have unparseable OHL completion date", "Validity", "Medium", badOhlDate));
        if (badFlafDate > 0)  wmrIssues.Add(Issue("flaf_issue_date",           $"{badFlafDate} rows have unparseable FLAF date — FLAF/SCR classification fails for those wells", "Validity", "Medium", badFlafDate));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number",  $"Mixed Week_Number format: {weekShort} rows use YY-MM-DD and {weekLong} use YYYY-MM-DD", "Consistency", "High", weekShort + weekLong));
        if (noSapMatch > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{noSapMatch} WMR wells have no SAP plan entry — cannot appear in OHL Plan count", "Consistency", "High", noSapMatch));
        if (dupWellWeek > 0)  wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (well, week) pairs — OHL classification depends on which row wins", "Integrity", "High", dupWellWeek));
        if (daysSince > 7)    wmrIssues.Add(Issue("Week_Number",               $"Latest WMR snapshot is {daysSince} days old ({latestWeek}) — OHL completion counts may be stale", "Freshness", daysSince > 14 ? "High" : "Medium", daysSince));
        wmrIssues.AddRange(wmrStructIssues);

        // SAP
        var sapTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapNullStart  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NULL OR LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))=''", ct);
        var sapBadStart   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NOT NULL AND LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))<>'' AND TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var noWmrForSap   = await Count(conn,
            "SELECT COUNT(DISTINCT Well_ID) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE Well_ID IS NOT NULL AND Well_ID<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=Well_ID)", ct);
        var (sapStructPenalty, sapStructIssues) = await StructuralIntegrity(conn, "SAP_DRILLING_SEQUENCE_History", sapTotal, "Well_ID", "WMR.pdo_well_id", ct);
        double sapScore = NaScore(sapTotal, ApplyGate(WeightedScore(Rate(sapNullWellId + sapNullStart, sapTotal * 2), Rate(sapBadStart, sapTotal),
            Rate(noWmrForSap, Math.Max(distinctWells + sapNullWellId, 1)), Rate(sapStructPenalty, sapTotal), 1.0),
            Rate(sapNullWellId + sapNullStart, sapTotal * 2), Rate(sapStructPenalty, sapTotal)));
        var sapIssues = new List<object>();
        if (sapNullWellId > 0) sapIssues.Add(Issue("Well_ID",         $"{sapNullWellId} SAP rows have NULL/empty Well_ID — absent from OHL Plan count", "Completeness", "High", sapNullWellId));
        if (sapNullStart > 0)  sapIssues.Add(Issue("Earl_start_date", $"{sapNullStart} SAP rows have NULL/empty plan start date — excluded from OHL Plan month", "Completeness", "High", sapNullStart));
        if (sapBadStart > 0)   sapIssues.Add(Issue("Earl_start_date", $"{sapBadStart} SAP rows have non-parseable plan start date", "Validity", "High", sapBadStart));
        if (noWmrForSap > 0)   sapIssues.Add(Issue("Well_ID",         $"{noWmrForSap} SAP plan wells have no WMR tracking row — appear in Plan count but never in Actual, inflating OHL Backlog", "Consistency", "High", noWmrForSap));
        sapIssues.AddRange(sapStructIssues);

        // ProjectIDs
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0, 1.0, Rate(noSapMatch, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullId + pidNullClust, pidTotal * 2), Rate(noSapMatch, Math.Max(distinctWells, 1))));
        var pidIssues = new List<object>();
        if (pidNullId > 0)    pidIssues.Add(Issue("ID",      $"{pidNullId} rows have NULL ID — invisible to cluster/type filters", "Completeness", "High", pidNullId));
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — wells excluded from cluster-filtered OHL views", "Completeness", "Medium", pidNullClust));

        double overall = wmrScore * 0.55 + sapScore * 0.35 + pidScore * 0.10;
        return BuildResponse("wroOhl",
            "Wells Readiness — OHL tab. Plan-to-Actual OHL completion funnel. " +
            "OHL completion derived from: overall_ohl_progr_100 (≥ 1.0) and ohl_completion_date. " +
            "FLAF/SCR classification from flaf_issue_date and scr_date. " +
            "Plan source: dbo.SAP_DRILLING_SEQUENCE_History.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal, reliabilityScore = Math.Round(sapScore, 1), reliabilityLabel = Label(sapScore), issues = sapIssues },
                new { table = "dbo.ProjectIDs",                    totalRows = pidTotal, reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }

    // =========================================================================
    // 17. WRO BUFFER — dbo.WMR + dbo.SAP_DRILLING_SEQUENCE_History + dbo.ProjectIDs
    // =========================================================================
    private async Task<object> QualityWroBuffer(CancellationToken ct)
    {
        await using var conn = Open();

        var wmrTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        var distinctWells = await Count(conn, "SELECT COUNT(DISTINCT pdo_well_id) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>''", ct);

        // Completeness — buffer location fields
        var nullWellId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NULL OR pdo_well_id=''", ct);
        var nullWeek      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE Week_Number IS NULL OR Week_Number=''", ct);
        var nullBufLoc    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND [buffer_status] IS NULL", ct);
        var nullFlaf      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' AND flaf_issue_date IS NULL", ct);

        // Validity — unexpected values in categorical buffer status
        var badBufLoc     = await Count(conn,
            "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE [buffer_status] IS NOT NULL AND LTRIM(RTRIM(CAST([buffer_status] AS NVARCHAR(200))))<>'' " +
            "AND LTRIM(RTRIM(CAST([buffer_status] AS NVARCHAR(200)))) NOT IN " +
            "('Completed','In Progress','Not Started','On Hold','Suspended','Hold','N/A','Pending','Cancelled')", ct);
        var badFlafDate   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(flaf_issue_date AS NVARCHAR(100))))<>'' AND TRY_CAST(flaf_issue_date AS DATE) IS NULL", ct);

        // Consistency
        var weekShort     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=8", ct);
        var weekLong      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[WMR] WITH (NOLOCK) WHERE LEN(ISNULL(Week_Number,''))=10", ct);
        var noSapMatch    = await Count(conn,
            "SELECT COUNT(DISTINCT w.pdo_well_id) FROM [dbo].[WMR] w WITH (NOLOCK) " +
            "WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK) WHERE s.Well_ID=w.pdo_well_id)", ct);

        // Integrity
        var dupWellWeek   = await Count(conn,
            "SELECT COUNT(*) FROM (SELECT pdo_well_id,Week_Number,COUNT(*) c FROM [dbo].[WMR] WITH (NOLOCK) " +
            "WHERE pdo_well_id IS NOT NULL AND pdo_well_id<>'' GROUP BY pdo_well_id,Week_Number HAVING COUNT(*)>1) x", ct);

        // Freshness
        var latestWeek    = await Scalar(conn,
            "SELECT CONVERT(NVARCHAR(12),MAX(COALESCE(TRY_CONVERT(DATE,Week_Number,23),TRY_CONVERT(DATE,'20'+Week_Number,23)))) FROM [dbo].[WMR] WITH (NOLOCK)", ct);
        int daysSince = latestWeek is not null && DateOnly.TryParse(latestWeek, out var lw4)
            ? DateOnly.FromDateTime(DateTime.UtcNow).DayNumber - lw4.DayNumber : 999;
        double freshnessRate = FreshnessRate(daysSince, 7, 28);

        var (wmrStructPenalty, wmrStructIssues) = await StructuralIntegrity(conn, "WMR", wmrTotal, "project_id", "ProjectIDs.ID", ct);
        double completeness = Rate(nullWellId + nullWeek + nullBufLoc + nullFlaf, wmrTotal * 4);
        double validity     = Rate(badBufLoc + badFlafDate, wmrTotal * 2);
        double consistency  = Rate((weekShort > 0 && weekLong > 0 ? Math.Min(weekShort, weekLong) : 0) + noSapMatch, wmrTotal + distinctWells);
        double integrity    = Rate(dupWellWeek + wmrStructPenalty, wmrTotal + distinctWells);
        double wmrScore     = NaScore(wmrTotal, ApplyGate(WeightedScore(completeness, validity, consistency, integrity, freshnessRate), completeness, integrity));

        var wmrIssues = new List<object>();
        if (nullWellId > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{nullWellId} rows have NULL/empty pdo_well_id — excluded from all Buffer Location counts", "Completeness", "High", nullWellId));
        if (nullWeek > 0)     wmrIssues.Add(Issue("Week_Number",               $"{nullWeek} rows have NULL Week_Number — excluded from all date-filtered Buffer snapshots", "Completeness", "High", nullWeek));
        if (nullBufLoc > 0)   wmrIssues.Add(Issue("buffer_status",           $"{nullBufLoc} wells have NULL buffer_status — cannot be classified in the Buffer Location funnel", "Completeness", "High", nullBufLoc));
        if (nullFlaf > 0)     wmrIssues.Add(Issue("flaf_issue_date",           $"{nullFlaf} wells have no FLAF date — cannot be excluded from Buffer Plan count as FLAF/SCR-delayed", "Completeness", "Medium", nullFlaf));
        if (badBufLoc > 0)    wmrIssues.Add(Issue("buffer_status",             $"{badBufLoc} rows have unrecognised buffer_status value — those wells fall through classification logic", "Validity", "Medium", badBufLoc));
        if (badFlafDate > 0)  wmrIssues.Add(Issue("flaf_issue_date",           $"{badFlafDate} rows have unparseable FLAF date", "Validity", "Medium", badFlafDate));
        if (weekShort > 0 && weekLong > 0) wmrIssues.Add(Issue("Week_Number",  $"Mixed Week_Number format: {weekShort} rows use YY-MM-DD and {weekLong} use YYYY-MM-DD", "Consistency", "High", weekShort + weekLong));
        if (noSapMatch > 0)   wmrIssues.Add(Issue("pdo_well_id",               $"{noSapMatch} WMR wells have no SAP plan entry — cannot appear in Buffer Location Plan count", "Consistency", "High", noSapMatch));
        if (dupWellWeek > 0)  wmrIssues.Add(Issue("pdo_well_id + Week_Number", $"{dupWellWeek} duplicate (well, week) pairs — Buffer classification depends on which row wins", "Integrity", "High", dupWellWeek));
        if (daysSince > 7)    wmrIssues.Add(Issue("Week_Number",               $"Latest WMR snapshot is {daysSince} days old ({latestWeek}) — Buffer Location status may be stale", "Freshness", daysSince > 14 ? "High" : "Medium", daysSince));
        wmrIssues.AddRange(wmrStructIssues);

        // SAP
        var sapTotal      = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)", ct);
        var sapNullWellId = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Well_ID IS NULL OR Well_ID=''", ct);
        var sapNullStart  = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NULL OR LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))=''", ct);
        var sapBadStart   = await Count(conn, "SELECT COUNT(*) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) WHERE Earl_start_date IS NOT NULL AND LTRIM(RTRIM(CAST(Earl_start_date AS NVARCHAR(50))))<>'' AND TRY_CAST(Earl_start_date AS DATE) IS NULL", ct);
        var noWmrForSap   = await Count(conn,
            "SELECT COUNT(DISTINCT Well_ID) FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK) " +
            "WHERE Well_ID IS NOT NULL AND Well_ID<>'' " +
            "AND NOT EXISTS(SELECT 1 FROM [dbo].[WMR] w WITH (NOLOCK) WHERE w.pdo_well_id=Well_ID)", ct);
        var (sapStructPenalty, sapStructIssues) = await StructuralIntegrity(conn, "SAP_DRILLING_SEQUENCE_History", sapTotal, "Well_ID", "WMR.pdo_well_id", ct);
        double sapScore = NaScore(sapTotal, ApplyGate(WeightedScore(Rate(sapNullWellId + sapNullStart, sapTotal * 2), Rate(sapBadStart, sapTotal),
            Rate(noWmrForSap, Math.Max(distinctWells + sapNullWellId, 1)), Rate(sapStructPenalty, sapTotal), 1.0),
            Rate(sapNullWellId + sapNullStart, sapTotal * 2), Rate(sapStructPenalty, sapTotal)));
        var sapIssues = new List<object>();
        if (sapNullWellId > 0) sapIssues.Add(Issue("Well_ID",         $"{sapNullWellId} SAP rows have NULL/empty Well_ID — absent from Buffer Plan count", "Completeness", "High", sapNullWellId));
        if (sapNullStart > 0)  sapIssues.Add(Issue("Earl_start_date", $"{sapNullStart} SAP rows have NULL/empty plan start date — excluded from Buffer Plan month", "Completeness", "High", sapNullStart));
        if (sapBadStart > 0)   sapIssues.Add(Issue("Earl_start_date", $"{sapBadStart} SAP rows have non-parseable plan start date", "Validity", "High", sapBadStart));
        if (noWmrForSap > 0)   sapIssues.Add(Issue("Well_ID",         $"{noWmrForSap} SAP plan wells have no WMR tracking row — appear in Plan count but never in Actual, inflating Buffer Backlog", "Consistency", "High", noWmrForSap));
        sapIssues.AddRange(sapStructIssues);

        // ProjectIDs
        var pidTotal     = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK)", ct);
        var pidNullId    = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE ID IS NULL", ct);
        var pidNullClust = await Count(conn, "SELECT COUNT(*) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE [Cluster] IS NULL OR LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))=''", ct);
        double pidScore  = NaScore(pidTotal, ApplyGate(WeightedScore(Rate(pidNullId + pidNullClust, pidTotal * 2), 1.0, 1.0, Rate(noSapMatch, Math.Max(distinctWells, 1)), 1.0), Rate(pidNullId + pidNullClust, pidTotal * 2), Rate(noSapMatch, Math.Max(distinctWells, 1))));
        var pidIssues = new List<object>();
        if (pidNullId > 0)    pidIssues.Add(Issue("ID",      $"{pidNullId} rows have NULL ID — invisible to cluster/type filters", "Completeness", "High", pidNullId));
        if (pidNullClust > 0) pidIssues.Add(Issue("Cluster", $"{pidNullClust} rows have NULL/empty Cluster — wells excluded from cluster-filtered Buffer views", "Completeness", "Medium", pidNullClust));

        double overall = wmrScore * 0.55 + sapScore * 0.35 + pidScore * 0.10;
        return BuildResponse("wroBuffer",
            "Wells Readiness — Buffer Location tab. Plan-to-Actual Buffer Location funnel. " +
            "Buffer completion derived from: buffer_status field on the latest WMR weekly snapshot. " +
            "FLAF/SCR classification from flaf_issue_date. " +
            "Plan source: dbo.SAP_DRILLING_SEQUENCE_History.",
            Math.Round(overall, 1),
            new List<object>
            {
                new { table = "dbo.WMR",                           totalRows = wmrTotal, reliabilityScore = Math.Round(wmrScore, 1), reliabilityLabel = Label(wmrScore), issues = wmrIssues },
                new { table = "dbo.SAP_DRILLING_SEQUENCE_History", totalRows = sapTotal, reliabilityScore = Math.Round(sapScore, 1), reliabilityLabel = Label(sapScore), issues = sapIssues },
                new { table = "dbo.ProjectIDs",                    totalRows = pidTotal, reliabilityScore = Math.Round(pidScore, 1), reliabilityLabel = Label(pidScore), issues = pidIssues }
            });
    }
}
