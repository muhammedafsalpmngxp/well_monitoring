namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A saved database view definition created via the View Builder UI.
/// Stores the full builder state (tables, joins, columns, filters) as JSON
/// and the generated/manual SQL statement.
/// Maps to [core].[DatabaseViews] — FK to DatabaseConnections.
/// </summary>
public class DatabaseView
{
    public long Id { get; set; }
    public long ConnectionId { get; set; }
    public string ViewName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsDistinct { get; set; }

    /// <summary>JSON array of table references: [{id, table, alias}]</summary>
    public string TablesJson { get; set; } = "[]";

    /// <summary>JSON object of joins keyed by table id: {tableId: {type, conditions: [{leftId, leftCol, rightCol}]}}</summary>
    public string JoinsJson { get; set; } = "{}";

    /// <summary>JSON array of selected columns: ["tableId.colName"]</summary>
    public string SelectedColumnsJson { get; set; } = "[]";

    /// <summary>JSON object of column aliases: {"tableId.colName": "outputAlias"}</summary>
    public string? ColumnAliasesJson { get; set; }

    /// <summary>JSON array of filters: [{fid, tableId, col, op, value, connector}]</summary>
    public string? FiltersJson { get; set; }

    /// <summary>Auto-generated SQL from the builder definition.</summary>
    public string GeneratedSql { get; set; } = string.Empty;

    /// <summary>Hand-edited SQL by the user (null = use generated).</summary>
    public string? ManualSql { get; set; }

    /// <summary>JSON array of the last preview result rows.</summary>
    public string? PreviewDataJson { get; set; }

    /// <summary>JSON array of column names from the last preview execution.</summary>
    public string? PreviewColumnsJson { get; set; }

    /// <summary>Number of rows returned in the last preview.</summary>
    public int? PreviewRowCount { get; set; }

    /// <summary>Timestamp of the last preview execution.</summary>
    public DateTime? PreviewExecutedAt { get; set; }

    /// <summary>Comma-separated list of table names used (for display).</summary>
    public string TablesUsed { get; set; } = string.Empty;

    /// <summary>Comma-separated "schema.table.column" list of every column the view uses.</summary>
    public string? ColumnsUsed { get; set; }

    public int ColumnCount { get; set; }
    public long? RowCount { get; set; }

    public decimal? Reliability { get; set; }

    /// <summary>built_in | custom</summary>
    public string SourceType { get; set; } = "custom";

    /// <summary>view | cte | component — determines how this item is used in the builder.</summary>
    public string ViewType { get; set; } = "view";

    /// <summary>JSON array of referenced CTE view IDs: [12, 34]</summary>
    public string? ReferencedCteIdsJson { get; set; }

    /// <summary>JSON array of referenced component view IDs for UNION ALL: [56, 78]</summary>
    public string? ReferencedComponentIdsJson { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }

    public DatabaseConnection? Connection { get; set; }
}
