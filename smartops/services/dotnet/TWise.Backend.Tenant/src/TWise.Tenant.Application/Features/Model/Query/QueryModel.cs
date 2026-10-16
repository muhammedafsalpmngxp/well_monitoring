using TWise.Tenant.Application.Features.Model.Datasets;

namespace TWise.Tenant.Application.Features.Model.Query;

// ── Model, as the compiler sees it ─────────────────────────────────────────────

/// <summary>
/// View is set for a view source: its checked SQL, compiled as a derived table in place of SchemaName.SourceName.
/// Database is set for a table of another database on the model's server, which is then read as Database.SchemaName.SourceName.
/// Script is set for a saved view run as written: the query runs its batch into a temporary table and reads that.
/// </summary>
public sealed record ModelSource(
    long Id, string Alias, string SchemaName, string SourceName, string RlsMode, string? RlsPlantColumn, CheckedViewSql? View = null,
    string? Database = null, ScriptSql? Script = null);

/// <summary>
/// A saved view run as written (ScriptSource): its batch as saved, the columns SQL Server described for it in their
/// order, the model field ("alias.column") each bound variable takes its value from, the name people know it by, and the
/// connection's database, which a three-part name in the batch may name.
/// </summary>
public sealed record ScriptSql(
    string Batch, IReadOnlyList<ViewColumn> Columns, IReadOnlyDictionary<string, string> Bindings, string Name, string? Database = null);

/// <summary>For many_to_one, From is the many side and To is the one side.</summary>
public sealed record ModelRelationship(long Id, long FromSourceId, string FromColumn, long ToSourceId, string ToColumn, string Cardinality);

public sealed record ModelMeasure(string Name, MeasureNode Expression);

/// <summary>
/// A calculation on one row of a source, used by name like a column of it. Expression is null when the
/// stored tree cannot be read; only a query that uses the column is then refused.
/// </summary>
public sealed record ModelCalculatedColumn(long SourceId, string Name, MeasureNode? Expression);

/// <summary>
/// A change applied to one table column of a source whenever the column is read. Kind is trim, null_fill,
/// replace, type or remove_rows. Value is the fill value, the text a replace finds, the new type (number, date
/// or text) or what a removal compares with. Options holds the other settings: with and match for replace,
/// style for a change to date, op for remove_rows. A source's transforms apply in list order.
/// </summary>
public sealed record ModelTransform(
    long SourceId, string Column, string Kind, string? Value = null, IReadOnlyDictionary<string, string>? Options = null);

/// <summary>Only active relationships belong here. Transforms are listed in the order they apply.</summary>
public sealed record DatasetModel(
    IReadOnlyList<ModelSource> Sources,
    IReadOnlyList<ModelRelationship> Relationships,
    IReadOnlyList<ModelMeasure> Measures,
    IReadOnlyList<ModelCalculatedColumn>? CalculatedColumns = null,
    IReadOnlyList<ModelTransform>? Transforms = null);

// ── Request ────────────────────────────────────────────────────────────────────

/// <summary>
/// Dimensions and filter fields are "alias.column". Measures are measure names. Refresh reads the
/// dataset and the rows from the database even when they are cached, and keeps what it read.
/// Totals adds a subtotal row for each group of the dimensions and a grand total row (GROUP BY
/// ROLLUP), and a last column, QueryCompiler.LevelColumn, that tells them apart. Draft runs on the
/// dataset as it is being edited instead of its published version (Model Studio, canvases in draft).
/// </summary>
public sealed record QueryRequest(
    long DatasetId,
    IReadOnlyList<string> Dimensions,
    IReadOnlyList<string> Measures,
    IReadOnlyList<QueryFilter>? Filters = null,
    QuerySort? Sort = null,
    int? TopN = null,
    bool Refresh = false,
    bool Totals = false,
    bool Draft = false,
    IReadOnlyList<FieldValue>? Values = null);

/// <summary>
/// A value a report object asks for without a stored measure: Fn (sum, avg, min, max, count or count_distinct) of
/// Field ("alias.column"), answered under Name, which the request also lists in Measures. The model is not changed.
/// </summary>
public sealed record FieldValue(string Name, string Field, string Fn);

/// <summary>
/// op is eq, neq, gt, gte, lt, lte, in, not_in, between, contains, not_contains, starts_with, ends_with, is_null or
/// not_null. any keeps a row when one of the filters in Any does (OR); they must be on the same field. top and bottom
/// keep the field's Values[0] values with the highest or lowest Values[1] measure (or, with three values, the Values[2]
/// aggregate of the Values[1] field: sum, avg, min, max, count or count_distinct), under the request's other filters;
/// RunModelQueryHandler turns them into an in filter before the query is compiled.
/// </summary>
public sealed record QueryFilter(string Field, string Op, IReadOnlyList<string>? Values = null, IReadOnlyList<QueryFilter>? Any = null);

/// <summary>Field is a requested dimension ("alias.column") or a requested measure name.</summary>
public sealed record QuerySort(string Field, bool Descending = false);

/// <summary>
/// A source to sample in the Get Data navigator. Kind is table, view or script; for a view or script, SourceName is its id. ConnectionId
/// names another database on the model's server to read a table from; null reads the model's own.
/// </summary>
public sealed record SourcePreviewRequest(string Kind, string SchemaName, string SourceName, long? ConnectionId = null);

public sealed record UserScope(bool IsAdmin, IReadOnlyList<int> PlantCodes);

// ── Catalogue ──────────────────────────────────────────────────────────────────

/// <summary>
/// Columns that exist on the dataset's connection, from core.DatabaseSchema.
/// Every identifier the compiler emits must be found here first.
/// </summary>
public sealed class SchemaCatalog
{
    private readonly Dictionary<string, string?> _columns = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _types = new(StringComparer.OrdinalIgnoreCase);

    public SchemaCatalog(IEnumerable<(string Schema, string Table, string Column)> columns)
        : this(columns.Select(c => (c.Schema, c.Table, c.Column, (string?)null)))
    {
    }

    /// <summary>DataType is the SQL Server type name, or null when it is not known.</summary>
    public SchemaCatalog(IEnumerable<(string Schema, string Table, string Column, string? DataType)> columns)
    {
        foreach (var (schema, table, column, dataType) in columns)
        {
            var key = Key(schema, table, column);
            // Two spellings of one name (a case-sensitive database) cannot be told apart
            // by a case-insensitive request, so neither is usable.
            _columns[key] = _columns.TryGetValue(key, out var seen) && seen != column ? null : column;
            if (!string.IsNullOrWhiteSpace(dataType)) _types[key] = dataType;
        }
    }

    /// <summary>The column's own spelling, or null if the table has no such column.</summary>
    public string? Column(string schema, string table, string column)
        => _columns.GetValueOrDefault(Key(schema, table, column));

    /// <summary>The column's SQL Server type name, or null when it is not known.</summary>
    public string? DataType(string schema, string table, string column)
        => _types.GetValueOrDefault(Key(schema, table, column));

    private static string Key(string schema, string table, string column) => $"{schema}\u0001{table}\u0001{column}";
}

// ── Result ─────────────────────────────────────────────────────────────────────

/// <summary>SkippedFilters names the filter fields the query does not apply (ScriptSource.TakeBound).</summary>
public sealed record CompiledQuery(string Sql, IReadOnlyDictionary<string, object> Parameters, IReadOnlyList<string> Columns)
{
    public IReadOnlyList<string> SkippedFilters { get; init; } = [];
}

/// <summary>
/// FetchedAt is when the rows were read from the database (UTC). FromCache is true when this
/// answer came from the result cache rather than the database. SkippedFilters names the filter fields the rows are not
/// filtered by: a query on saved views alone skips a filter on a table it does not read and no variable takes.
/// </summary>
public sealed record QueryResult(
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, object?>> Rows,
    DateTime FetchedAt = default,
    bool FromCache = false)
{
    public IReadOnlyList<string> SkippedFilters { get; init; } = [];
}

/// <summary>
/// The SQL of a View Builder view that passed the view contract and the embedding checks, printed again
/// from its parse tree. Only ViewSource.Prepare creates one, or ViewSource.Stored from the text Prepare gave
/// when the source was saved, so the compiler, which takes view text only in this type, cannot place stored
/// text in a query that the parser has not accepted.
/// </summary>
public sealed class CheckedViewSql
{
    internal CheckedViewSql(string sql) => Sql = sql;

    public string Sql { get; }
}

// ── Errors ─────────────────────────────────────────────────────────────────────

/// <summary>Stable codes the UI maps to a plain-language fix. No SQL error text reaches a user.</summary>
public static class QueryErrors
{
    public const string EmptyRequest = "empty_request";
    public const string UnknownDataset = "unknown_dataset";
    public const string UnknownField = "unknown_field";
    public const string InvalidMeasure = "invalid_measure";
    public const string InvalidColumn = "invalid_column";
    /// <summary>A calculated column used a measure function, which reads other rows. The plant filter runs after columns are calculated.</summary>
    public const string CrossRowInColumn = "cross_row_column";
    /// <summary>A calculated column, with the columns it builds on, writes out to more SQL than a query may hold.</summary>
    public const string FormulaTooLarge = "formula_too_large";
    /// <summary>COUNTROWS of a table the query joins to, not the one it reads its rows from, would count rows that have no match.</summary>
    public const string CountRowsJoined = "count_rows_joined";
    public const string InvalidFilter = "invalid_filter";
    public const string InvalidTotals = "invalid_totals";
    public const string MissingRelationship = "missing_relationship";
    public const string AmbiguousPath = "ambiguous_path";
    public const string FanTrap = "fan_trap";
    public const string RlsUnconfigured = "rls_unconfigured";
    public const string Timeout = "timeout";
    public const string Busy = "busy";
    public const string SourceNotContractCompliant = "source_not_contract_compliant";
    public const string RowsHidden = "rows_hidden";
    public const string ViewSourceNeedsUpdate = "view_source_needs_update";
}

public sealed class QueryException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
