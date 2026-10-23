using System.Text.Json.Serialization;

namespace TWise.Tenant.Domain.DTOs;

// ── DatabaseView DTOs ───────────────────────────────────────────────────────

public record DatabaseViewDto(
    long Id,
    long ConnectionId,
    string? ConnectionName,
    string ViewName,
    string? Description,
    bool IsDistinct,
    string TablesJson,
    string JoinsJson,
    string SelectedColumnsJson,
    string? ColumnAliasesJson,
    string? FiltersJson,
    string GeneratedSql,
    string? ManualSql,
    string? PreviewDataJson,
    string? PreviewColumnsJson,
    int? PreviewRowCount,
    DateTime? PreviewExecutedAt,
    string TablesUsed,
    int ColumnCount,
    long? RowCount,
    decimal? Reliability,
    [property: JsonPropertyName("reliability_breakdown")] string ReliabilityBreakdown,
    string SourceType,
    string ViewType,
    string? ReferencedCteIdsJson,
    string? ReferencedComponentIdsJson,
    long TenantId,
    long CreatedBy,
    DateTime CreatedAt,
    long? ModifiedBy,
    DateTime ModifiedAt,
    IReadOnlyList<ViewContractViolation> ContractViolations
);

/// <summary>One failed rule of docs/VIEW-CONTRACT.md. An empty list means model-compliant.</summary>
public record ViewContractViolation(int Rule, string Message);

public record ViewContractReportItem(
    long Id,
    string ViewName,
    string ViewType,
    IReadOnlyList<ViewContractViolation> Violations
);

public record DatabaseViewListDto(
    long Id,
    string ViewName,
    string? Description,
    long ConnectionId,
    string? ConnectionName,
    string TablesUsed,
    int ColumnCount,
    long? RowCount,
    string SourceType,
    string ViewType,
    DateTime CreatedAt,
    DateTime ModifiedAt
);

public record CreateDatabaseViewRequest(
    long ConnectionId,
    string ViewName,
    string? Description,
    bool IsDistinct,
    string TablesJson,
    string JoinsJson,
    string SelectedColumnsJson,
    string? ColumnAliasesJson,
    string? FiltersJson,
    string GeneratedSql,
    string? ManualSql,
    string TablesUsed,
    int ColumnCount,
    string ViewType = "view",
    string? ReferencedCteIdsJson = null,
    string? ReferencedComponentIdsJson = null
);

public record UpdateDatabaseViewRequest(
    long ConnectionId,
    string ViewName,
    string? Description,
    bool IsDistinct,
    string TablesJson,
    string JoinsJson,
    string SelectedColumnsJson,
    string? ColumnAliasesJson,
    string? FiltersJson,
    string GeneratedSql,
    string? ManualSql,
    string TablesUsed,
    int ColumnCount,
    string ViewType = "view",
    string? ReferencedCteIdsJson = null,
    string? ReferencedComponentIdsJson = null
);

// Sql is optional: when omitted the SQL is resolved server-side from ViewId.
// MaxRows 0 or below means "no cap".
public record PreviewDatabaseViewRequest(
    long ConnectionId,
    string? Sql = null,
    long? ViewId = null,
    int MaxRows = 100,
    Dictionary<string, string>? GlobalFilters = null,
    IReadOnlyList<ChartFilterParam>? Filters = null
);

public record PreviewDatabaseViewResponse(
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, object?>> Rows,
    int TotalRows
);

/// <summary>The last stored preview of a view; ExecutedAt is when it was produced.</summary>
public record PreviewSnapshotDto(
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, object?>> Rows,
    int TotalRows,
    DateTime? ExecutedAt
);

// ── Index advice: existing and suggested indexes for the tables a view reads ──────────────────

/// <summary>Sql is the view's SQL (builder output or edited SQL); it is only read, never run.</summary>
public record ViewIndexAdviceRequest(long ConnectionId, string Sql);

/// <summary>Supported is false for non-SQL Server connections or SQL that does not parse; Message says why.</summary>
public record ViewIndexAdviceResponse(
    bool Supported,
    string? Message,
    IReadOnlyList<ViewTableIndexAdvice> Tables
);

/// <summary>One table the view reads: how the view uses it, the indexes it has, and the ones that would help.</summary>
public record ViewTableIndexAdvice(
    string Table,
    long? RowCount,
    IReadOnlyList<string> FilterColumns,
    IReadOnlyList<string> JoinColumns,
    IReadOnlyList<string> SortColumns,
    IReadOnlyList<ExistingIndexDto> ExistingIndexes,
    IReadOnlyList<SuggestedIndexDto> SuggestedIndexes
);

/// <summary>SupportsView: the index leads with a column the view filters, joins or sorts on.</summary>
public record ExistingIndexDto(
    string Name,
    string Type,
    bool IsUnique,
    bool IsPrimaryKey,
    IReadOnlyList<string> KeyColumns,
    IReadOnlyList<string> IncludedColumns,
    bool SupportsView
);

/// <summary>Source is "View" (from the view's filters/joins) or "SQL Server" (missing-index statistics).</summary>
public record SuggestedIndexDto(
    IReadOnlyList<string> KeyColumns,
    IReadOnlyList<string> IncludedColumns,
    string Reason,
    string Source,
    double? EstimatedImpact,
    string CreateSql
);
