using System.Text.Json;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

// ── Requests ───────────────────────────────────────────────────────────────────

public sealed record CreateDatasetRequest(string Name, string? Description, long ConnectionId);

public sealed record UpdateDatasetRequest(string Name, string? Description);

/// <summary>
/// RlsMode is plant or none. RlsPlantColumn is required for plant. Kind is table (the default, which also
/// covers uploaded tables in the import schema), view or script (a view used as written, ScriptSource); for a view or
/// script, SourceName is the View Builder view's id and SchemaName is ignored. ConnectionId names another database on the model's server to read a table
/// from; null or the model's own connection reads the model's database. Views come from the model's database only.
/// </summary>
public sealed record AddSourceRequest(
    string SchemaName, string SourceName, string Alias, string RlsMode, string? RlsPlantColumn, string Kind = "table", long? ConnectionId = null);

public sealed record UpdateSourceRequest(string RlsMode, string? RlsPlantColumn);

/// <summary>The columns of one table hidden from report builders; an empty list shows them all.</summary>
public sealed record HiddenColumnsRequest(IReadOnlyList<string> Columns);

/// <summary>A table's name as people read it and its description; blank clears either.</summary>
public sealed record SourceDetailsRequest(string? Caption, string? Description);

/// <summary>Binds a variable a saved view declares to a model field ("alias.column"); a blank field unbinds it.</summary>
public sealed record ParameterBindingRequest(string Name, string? Field);

/// <summary>
/// For many_to_one, From is the many side. DetectedFrom is fk for an accepted suggestion and
/// user for a relationship drawn in the diagram.
/// </summary>
public sealed record AddRelationshipRequest(long FromSourceId, string FromColumn, long ToSourceId, string ToColumn, string Cardinality, string DetectedFrom);

public sealed record UpdateRelationshipRequest(string Cardinality);

/// <summary>
/// Expression is the measure tree as JSON, read by the handler so that a body the tree reader
/// cannot parse is a plain validation error rather than a deserialiser message.
/// </summary>
public sealed record SaveMeasureRequest(string Name, JsonElement Expression);

/// <summary>Where a measure is listed: under a table (or null for the dataset's measures) and in a folder (or none).</summary>
public sealed record MeasurePlacementRequest(long? HomeSourceId, string? Folder);

/// <summary>
/// Expression is the formula tree as JSON, read by the handler so that a body the tree reader cannot
/// parse is a plain validation error, as for measures.
/// </summary>
public sealed record SaveCalculatedColumnRequest(long SourceId, string Name, JsonElement Expression);

/// <summary>A calculated column keeps its table; only its name and formula change.</summary>
public sealed record UpdateCalculatedColumnRequest(string Name, JsonElement Expression);

/// <summary>A formula to check without saving it. MeasureId or ColumnId names the stored one being changed.</summary>
public sealed record CheckMeasureRequest(string Name, JsonElement Expression, long? MeasureId);
public sealed record CheckCalculatedColumnRequest(long SourceId, string Name, JsonElement Expression, long? ColumnId);

/// <summary>A formula that passed every check, and the kind of value it gives: number, text or date.</summary>
public sealed record FormulaCheckDto(string Kind);

/// <summary>
/// Kind is trim, null_fill, replace, type or remove_rows. Value is what fills a blank cell, the text a replace
/// finds, the new type (number, date or text), or what a removal compares with. Options holds the other settings:
/// with and match (part or whole) for replace, style (iso, dmy or mdy) for a change to date, op for remove_rows.
/// </summary>
public sealed record AddTransformRequest(
    long SourceId, string Column, string Kind, string? Value, IReadOnlyDictionary<string, string>? Options = null);

// ── Responses ──────────────────────────────────────────────────────────────────

public sealed record DatasetSummaryDto(long Id, string Name, string? Description, long ConnectionId, string Status, DateTime CreatedAt, DateTime? PublishedAt = null)
{
    public static DatasetSummaryDto From(Dataset d) => new(d.Id, d.Name, d.Description, d.ConnectionId, d.Status, d.CreatedAt, d.PublishedAt);
}

/// <summary>
/// A connection of the tenant. In the list for one data model, Joinable says whether its tables can be added to
/// that model, and Reason says why not (DatasetRules.CannotJoin).
/// </summary>
public sealed record DatasetConnectionDto(long Id, string ConnectionName, string DatabaseName, bool Joinable = true, string? Reason = null);

/// <summary>
/// Kind is table, view or script. Label names the source for people: schema.table, or the view's name. ViewChanged is
/// true for a view or script source whose view no longer matches the SQL stored when it was added (edited, broken or
/// deleted since, or stored before the SQL was kept); the source keeps reading its stored SQL until a modeller updates it.
/// Sql and Parameters are set for a script source: the batch it runs and the variables it declares.
/// ConnectionId is set for a table read from another database than the model's, and null otherwise. ConnectionName
/// and DatabaseName name the connection the source is read from, the model's own included; null when it is gone.
/// </summary>
public sealed record SourceDto(
    long Id, string SchemaName, string SourceName, string Alias, string RlsMode, string? RlsPlantColumn, string Kind, string Label,
    bool ViewChanged = false, IReadOnlyList<string>? HiddenColumns = null, string? Caption = null, string? Description = null,
    long? ConnectionId = null, string? ConnectionName = null, string? DatabaseName = null,
    string? Sql = null, IReadOnlyList<ScriptParameter>? Parameters = null);

public sealed record RelationshipDto(long Id, long FromSourceId, string FromColumn, long ToSourceId, string ToColumn, string Cardinality, string DetectedFrom);

/// <summary>Expression is null when the stored JSON cannot be read.</summary>
/// <summary>Folder groups measures in the Data pane; HomeSourceId is the table it is listed under, null for the dataset's measures.</summary>
public sealed record MeasureDto(long Id, string Name, MeasureNode? Expression, string? Folder = null, long? HomeSourceId = null);

/// <summary>Expression is null when the stored JSON cannot be read. DataType is number, text or date.</summary>
public sealed record CalculatedColumnDto(long Id, long SourceId, string Name, string DataType, MeasureNode? Expression);

/// <summary>Value and Options are as in AddTransformRequest; Options is null when there are none. The transforms of one table apply in SortOrder.</summary>
public sealed record TransformDto(
    long Id, long SourceId, string Column, string Kind, string? Value, int SortOrder, IReadOnlyDictionary<string, string>? Options = null);

/// <summary>
/// Status is draft until the first Publish. HasDraftChanges is true while the parts differ from the published
/// version, which is what canvases read; always true for a dataset never published.
/// </summary>
public sealed record DatasetDetailDto(
    long Id, string Name, string? Description, long ConnectionId, string Status, DateTime CreatedAt,
    IReadOnlyList<SourceDto> Sources, IReadOnlyList<RelationshipDto> Relationships, IReadOnlyList<MeasureDto> Measures,
    IReadOnlyList<CalculatedColumnDto> CalculatedColumns, IReadOnlyList<TransformDto> Transforms,
    DateTime? PublishedAt = null, bool HasDraftChanges = true)
{
    /// <summary>connections are the tenant's, to name where each source is read from; without them no source is named.</summary>
    public static DatasetDetailDto From(
        Dataset d, DatasetParts parts, IReadOnlyList<PreparedView>? views = null, IReadOnlyList<DatabaseConnection>? connections = null) => new(
        d.Id, d.Name, d.Description, d.ConnectionId, d.Status, d.CreatedAt,
        parts.Sources.OrderBy(s => s.Id)
            .Select(s => (Source: s, Connection: connections?.FirstOrDefault(c => c.Id == (s.ConnectionId ?? d.ConnectionId))))
            .Select(x => new SourceDto(x.Source.Id, x.Source.SchemaName, x.Source.SourceName, x.Source.Alias, x.Source.RlsMode, x.Source.RlsPlantColumn,
                x.Source.SourceKind, Label(x.Source, views ?? []), x.Source.SourceKind != "table" && ViewChanged(x.Source, views ?? []),
                DatasetRules.ReadHidden(x.Source.HiddenColumns), x.Source.Caption, x.Source.Description,
                x.Source.ConnectionId, x.Connection?.ConnectionName, x.Connection?.DatabaseName,
                IsScript(x.Source) ? x.Source.ViewSql : null,
                IsScript(x.Source) ? ScriptSource.Parameters(x.Source.ViewSql, x.Source.ParamsJson) : null)).ToList(),
        parts.Relationships.OrderBy(r => r.Id)
            .Select(r => new RelationshipDto(r.Id, r.FromSourceId, r.FromColumn, r.ToSourceId, r.ToColumn, r.Cardinality, r.DetectedFrom)).ToList(),
        parts.Measures.OrderBy(m => m.Name)
            .Select(m => new MeasureDto(m.Id, m.Name, DatasetRules.ReadMeasure(m.ExpressionAst), m.Folder, m.HomeSourceId)).ToList(),
        parts.CalculatedColumns.OrderBy(c => c.SourceId).ThenBy(c => c.Name)
            .Select(c => new CalculatedColumnDto(c.Id, c.SourceId, c.Name, c.DataType, DatasetRules.ReadMeasure(c.ExpressionAst))).ToList(),
        parts.Transforms.OrderBy(t => t.SourceId).ThenBy(t => t.SortOrder).ThenBy(t => t.Id)
            .Select(t => new TransformDto(t.Id, t.SourceId, t.ColumnName, t.Kind, DatasetRules.TransformValue(t.ConfigJson), t.SortOrder,
                DatasetRules.TransformOptions(t.ConfigJson))).ToList(),
        d.PublishedAt,
        PublishedModel.Read(d.PublishedModel) is not { } published || PublishedModel.Signature(published.Parts()) != PublishedModel.Signature(parts));

    /// <summary>The dataset for a caller who may read it but not change it: no saved view's SQL, and no parameter defaults from it.</summary>
    public DatasetDetailDto ForViewer() => this with
    {
        Sources = Sources.Select(s => s with { Sql = null, Parameters = s.Parameters?.Select(p => p with { Default = null }).ToList() }).ToList(),
    };

    // A script source keeps the view's text as saved, so any edit to it counts.
    private static bool ViewChanged(DatasetSource s, IReadOnlyList<PreparedView> views)
        => views.FirstOrDefault(v => ViewSource.Key(v.Id) == s.SourceName) is not { } view
           || (IsScript(s) ? s.ViewSql != view.Text : !view.IsUsable || s.ViewSql != view.Sql!.Sql);

    private static bool IsScript(DatasetSource s) => s.SourceKind == ScriptSource.Kind;

    private static string Label(DatasetSource s, IReadOnlyList<PreparedView> views) => s.SourceKind != "table"
        ? views.FirstOrDefault(v => ViewSource.Key(v.Id) == s.SourceName)?.Name ?? $"Deleted view {s.SourceName}"
        : $"{s.SchemaName}.{s.SourceName}";
}

/// <summary>Basis is fk for a declared foreign key, or data for a join found in the rows (MatchPercent of the many side's values matched).</summary>
public sealed record RelationshipSuggestionDto(
    long FromSourceId, string FromColumn, long ToSourceId, string ToColumn, string Cardinality, string Basis = "fk", int? MatchPercent = null);

/// <summary>
/// A view the Get Data navigator lists. Usable is false, with the reasons in Problems, when it cannot be added as a view.
/// AsScript is then true when it can be added as a saved view that runs as written; Columns are then its batch's, and
/// ScriptProblems say why it cannot when it cannot.
/// </summary>
public sealed record ViewChoiceDto(
    long Id, string Name, string? Description, bool Usable, IReadOnlyList<string> Problems, IReadOnlyList<ViewColumn> Columns,
    bool AsScript = false, IReadOnlyList<string>? ScriptProblems = null)
{
    public static ViewChoiceDto From(PreparedView v) => new(v.Id, v.Name, v.Description, v.IsUsable, v.Problems,
        v.IsUsable ? v.Columns : v.Script?.Columns ?? v.Columns, v.Script?.IsUsable == true, v.Script?.Problems);
}

// ── Loaded state ───────────────────────────────────────────────────────────────

/// <summary>The sources, relationships, measures, calculated columns and transforms of one dataset, as tracked entities.</summary>
public sealed record DatasetParts(
    List<DatasetSource> Sources, List<DatasetRelationship> Relationships, List<DatasetMeasure> Measures,
    List<DatasetCalculatedColumn> CalculatedColumns, List<DatasetTransform> Transforms);

/// <summary>One column of core.DatabaseSchema on the dataset's connection. DataType is null when not known.</summary>
public sealed record CatalogColumn(
    string Schema, string Table, string Column, bool IsPrimaryKey, bool IsForeignKey,
    string? ForeignKeySchema, string? ForeignKeyTable, string? ForeignKeyColumn, string? DataType = null);
