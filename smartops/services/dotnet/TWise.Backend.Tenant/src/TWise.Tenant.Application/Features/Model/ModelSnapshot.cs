using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model;

/// <summary>
/// One dataset as read in one go: the row, its connection (null when that was deleted), its
/// sources, relationships, measures, calculated columns and transforms, and the catalogue columns
/// of its tables and of the stored SQL of its view sources. It is untracked and shared between requests through ModelCache, so nothing may
/// change it. Version and Generation are the dataset version and tenant generation it was read at.
/// </summary>
public sealed record ModelSnapshot(
    long Version,
    Dataset Dataset,
    DatabaseConnection? Connection,
    IReadOnlyList<DatasetSource> Sources,
    IReadOnlyList<DatasetRelationship> Relationships,
    IReadOnlyList<DatasetMeasure> Measures,
    IReadOnlyList<CatalogColumn> Columns,
    IReadOnlyList<DatasetCalculatedColumn> CalculatedColumns,
    IReadOnlyList<DatasetTransform> Transforms,
    long Generation = 0)
{
    /// <summary>The version canvases read, as it was at the last Publish; null when the dataset was never published.</summary>
    public PublishedModel? Published { get; init; }

    /// <summary>
    /// The catalogue columns of the published sources the draft no longer has as they were, such as a view source whose
    /// stored SQL was refreshed. Kept apart from Columns so each version reads its own types: the draft's win for a draft
    /// query, the published version's for a published one.
    /// </summary>
    public IReadOnlyList<CatalogColumn> PublishedColumns { get; init; } = [];

    /// <summary>The tenant's connections, where a table of another database is looked up (DatasetSource.ConnectionId).</summary>
    public IReadOnlyList<DatabaseConnection> Connections { get; init; } = [];

    /// <summary>The columns SQL Server described for each script source's stored batch, draft and published, by the batch's text.</summary>
    public IReadOnlyDictionary<string, IReadOnlyList<ViewColumn>> Batches { get; init; } = new Dictionary<string, IReadOnlyList<ViewColumn>>();

    /// <summary>
    /// The database a table of another database is read from; null for the model's own. Refused when that
    /// connection is gone or can no longer be joined with the model's, so a query never reads the wrong database.
    /// </summary>
    public string? DatabaseOf(DatasetSource source)
    {
        if (source.ConnectionId is not { } id || id == Dataset.ConnectionId) return null;
        if (Connections.FirstOrDefault(c => c.Id == id) is not { } other)
            throw new QueryException(QueryErrors.UnknownDataset, $"{source.Alias} reads a database connection that no longer exists.");
        if (Connection is not null && DatasetRules.CannotJoin(Connection, other) is { } reason)
            throw new QueryException(QueryErrors.UnknownDataset, $"{source.Alias} cannot be read. {reason}");
        return other.DatabaseName;
    }

    /// <summary>
    /// The model a query runs on: the draft for Model Studio and for canvases still being edited, otherwise the
    /// published version. A dataset never published is read as it is. Columns hold both versions' tables.
    /// </summary>
    public ModelSnapshot Serving(bool draft) => draft || Published is not { } published ? this : this with
    {
        Sources = published.Sources, Relationships = published.Relationships, Measures = published.Measures,
        CalculatedColumns = published.CalculatedColumns, Transforms = published.Transforms, Published = null,
        Columns = [.. Columns, .. PublishedColumns], PublishedColumns = [],
    };

    /// <summary>Copies of the part lists, for DatasetDetailDto and the dataset rules, which take lists.</summary>
    public DatasetParts Parts() => new([.. Sources], [.. Relationships], [.. Measures], [.. CalculatedColumns], [.. Transforms]);

    /// <summary>
    /// The model the compiler sees: every source, the active relationships, the calculated columns
    /// and transforms, and only the named measures, so one unreadable measure does not break every query.
    /// A view source carries the SQL stored on it, never the view as it is now; one without stored SQL is refused.
    /// </summary>
    public DatasetModel Model(IEnumerable<string>? measureNames, IReadOnlyList<FieldValue>? values = null)
    {
        var wanted = new HashSet<string>(measureNames ?? [], StringComparer.OrdinalIgnoreCase);
        var find = DatasetRules.MeasureLookup(Measures);
        var measures = Measures.Where(m => wanted.Contains(m.Name))
            .Select(m => new ModelMeasure(m.Name, DatasetRules.ExpandRefs(DatasetRules.ReadMeasure(m.ExpressionAst)
                ?? throw new QueryException(QueryErrors.InvalidMeasure,
                    $"{m.Name} is stored in a form that cannot be read. Edit and save it again."), m.Name, find)))
            .ToList();
        foreach (var value in values ?? [])
        {
            if (Measures.Any(m => string.Equals(m.Name, value.Name, StringComparison.OrdinalIgnoreCase))
                || measures.Any(m => string.Equals(m.Name, value.Name, StringComparison.OrdinalIgnoreCase)))
                throw new QueryException(QueryErrors.InvalidMeasure, $"{value.Name} is already the name of a measure. Name the value another way.");
            measures.Add(new ModelMeasure(value.Name, FieldValueNode(value)));
        }
        var model = DatasetRules.ToModel(Parts(), measures);

        var viewSql = Sources.Where(s => s.SourceKind == "view").ToDictionary(s => s.Id, s => s.ViewSql);
        var scripts = Sources.Where(s => s.SourceKind == ScriptSource.Kind).ToDictionary(s => s.Id, Script);
        var databases = Sources.Where(s => s.ConnectionId is not null).ToDictionary(s => s.Id, DatabaseOf);
        return viewSql.Count == 0 && scripts.Count == 0 && databases.Count == 0 ? model : model with
        {
            Sources = model.Sources
                .Select(s => viewSql.TryGetValue(s.Id, out var sql) ? s with { View = ViewSource.Stored(s.Alias, sql) } : s)
                .Select(s => s with { Script = scripts.GetValueOrDefault(s.Id) })
                .Select(s => s with { Database = databases.GetValueOrDefault(s.Id) })
                .ToList(),
        };
    }

    /// <summary>A script source's stored batch with the columns described for it, in order; none when it could not be described.</summary>
    private ScriptSql Script(DatasetSource source) => new(
        source.ViewSql ?? "", Batches.GetValueOrDefault(source.ViewSql ?? "") ?? [], ScriptSource.Bindings(source.ParamsJson), source.Caption ?? source.Alias,
        Connection?.DatabaseName);

    private static readonly HashSet<string> FieldValueFns = new(StringComparer.OrdinalIgnoreCase)
        { "sum", "avg", "min", "max", "count", "count_distinct" };

    /// <summary>The aggregate a FieldValue asks for. The compiler then checks the column and that sum and avg get numbers.</summary>
    private static MeasureNode FieldValueNode(FieldValue value)
    {
        var dot = value.Field?.IndexOf('.') ?? -1;
        if (dot <= 0 || dot == value.Field!.Length - 1)
            throw new QueryException(QueryErrors.InvalidMeasure, $"{value.Name} needs a field written as table.column.");
        if (!FieldValueFns.Contains(value.Fn ?? ""))
            throw new QueryException(QueryErrors.InvalidMeasure, $"{value.Name}: {value.Fn} is not a way to add up a field. Use sum, avg, min, max, count or count_distinct.");
        return new AggregateNode(value.Fn!.ToLowerInvariant(), new ColumnNode(value.Field[..dot], value.Field[(dot + 1)..]));
    }

    /// <summary>The columns the compiler may use, with their SQL Server types; for a view source, those of its stored SQL.</summary>
    /// A column both versions have takes the type of the last one listed, so Columns come after PublishedColumns.
    public SchemaCatalog Catalog() => new(PublishedColumns.Concat(Columns).Select(c => (c.Schema, c.Table, c.Column, c.DataType)));
}
