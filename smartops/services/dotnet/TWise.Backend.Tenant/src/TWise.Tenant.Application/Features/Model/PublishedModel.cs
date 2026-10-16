using System.Text.Json;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model;

/// <summary>
/// A dataset's parts as they were at its last Publish, stored as JSON in model.Dataset.PublishedModel.
/// Canvases read this version; Model Studio edits the part tables, which are the draft.
/// </summary>
public sealed record PublishedModel(
    List<DatasetSource> Sources,
    List<DatasetRelationship> Relationships,
    List<DatasetMeasure> Measures,
    List<DatasetCalculatedColumn> CalculatedColumns,
    List<DatasetTransform> Transforms)
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = false };

    public static PublishedModel From(DatasetParts parts) => new(
        [.. parts.Sources], [.. parts.Relationships], [.. parts.Measures], [.. parts.CalculatedColumns], [.. parts.Transforms]);

    /// <summary>The stored JSON as a model, or null when there is none or it cannot be read.</summary>
    public static PublishedModel? Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<PublishedModel>(json, Options); }
        catch (JsonException) { return null; }
    }

    public string Write() => JsonSerializer.Serialize(this, Options);

    public DatasetParts Parts() => new([.. Sources], [.. Relationships], [.. Measures], [.. CalculatedColumns], [.. Transforms]);

    /// <summary>
    /// What the model means, without row ids: tables by alias and everything else by the aliases it names.
    /// Two versions with the same signature give the same answers, so Discard draft, which writes the rows
    /// again under new ids, leaves nothing to publish.
    /// </summary>
    public static string Signature(DatasetParts parts)
    {
        var alias = parts.Sources.ToDictionary(s => s.Id, s => s.Alias);
        string A(long id) => alias.GetValueOrDefault(id, "?");
        var meaning = new
        {
            Sources = parts.Sources.OrderBy(s => s.Alias, StringComparer.Ordinal)
                .Select(s => new { s.Alias, s.SourceKind, s.ConnectionId, s.SchemaName, s.SourceName, s.RlsMode, s.RlsPlantColumn, s.ViewSql, s.HiddenColumns, s.Caption, s.Description, s.ParamsJson }),
            Relationships = parts.Relationships
                .Select(r => new { From = A(r.FromSourceId), r.FromColumn, To = A(r.ToSourceId), r.ToColumn, r.Cardinality, r.IsActive })
                .OrderBy(r => $"{r.From}.{r.FromColumn}>{r.To}.{r.ToColumn}", StringComparer.Ordinal),
            Measures = parts.Measures.OrderBy(m => m.Name, StringComparer.Ordinal)
                .Select(m => new { m.Name, m.ExpressionAst, m.Format, m.Folder, Home = m.HomeSourceId is { } home ? A(home) : null }),
            Columns = parts.CalculatedColumns
                .Select(c => new { Table = A(c.SourceId), c.Name, c.ExpressionAst, c.DataType })
                .OrderBy(c => $"{c.Table}.{c.Name}", StringComparer.Ordinal),
            Transforms = parts.Transforms
                .Select(t => new { Table = A(t.SourceId), t.ColumnName, t.Kind, t.ConfigJson, t.SortOrder })
                .OrderBy(t => $"{t.Table}.{t.SortOrder:D6}.{t.ColumnName}", StringComparer.Ordinal),
        };
        return JsonSerializer.Serialize(meaning, Options);
    }
}
