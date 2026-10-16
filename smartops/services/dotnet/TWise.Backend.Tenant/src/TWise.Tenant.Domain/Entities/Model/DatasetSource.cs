namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>A table or view in a dataset. Maps to [model].[DatasetSource].</summary>
public class DatasetSource
{
    public long Id { get; set; }
    public long DatasetId { get; set; }

    /// <summary>table | view | script (a saved view run as written, ScriptSource)</summary>
    public string SourceKind { get; set; } = "table";

    public string SchemaName { get; set; } = string.Empty;
    public string SourceName { get; set; } = string.Empty;
    public string Alias { get; set; } = string.Empty;

    /// <summary>
    /// The connection whose database holds the table, when it is not the data model's own; null reads the model's
    /// database. Only a table may read another database, on the same server as the model's (DatasetRules.CannotJoin).
    /// </summary>
    public long? ConnectionId { get; set; }

    /// <summary>plant | none. There is no default; every source needs a deliberate choice.</summary>
    public string RlsMode { get; set; } = string.Empty;

    /// <summary>Column holding the plant code. Required when RlsMode is plant.</summary>
    public string? RlsPlantColumn { get; set; }

    public long? RowEstimate { get; set; }

    /// <summary>
    /// For a view source, the view's checked SQL as it was when a modeller added or last updated the source; for a
    /// script source, the view's batch as saved. Queries run this, never the view as it is now. Null for a table, and
    /// for a view source added before it was stored.
    /// </summary>
    public string? ViewSql { get; set; }

    /// <summary>
    /// For a script source, the model field each bound variable of the batch takes its value from, as a JSON object
    /// such as {"@plant":"Plant.plant_description"}; null when none is bound.
    /// </summary>
    public string? ParamsJson { get; set; }

    /// <summary>
    /// Columns hidden from report builders, as a JSON array of column names; null when none. Hidden columns still
    /// work in relationships, measures and filters, and Model Studio still lists them.
    /// </summary>
    public string? HiddenColumns { get; set; }

    /// <summary>The table's name as people read it; null shows the alias. Formulas always use the alias.</summary>
    public string? Caption { get; set; }

    /// <summary>What the table holds, for the modeller and report authors.</summary>
    public string? Description { get; set; }
}
