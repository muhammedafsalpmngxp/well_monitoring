using System.Text.Json;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>
/// Rules for changing a dataset. Pure, so each rule is pinned by a unit test. Column checks use the
/// same SchemaCatalog as the query compiler, and measures are checked by compiling them, so a dataset
/// that saves is one the compiler accepts.
/// </summary>
public static class DatasetRules
{
    public static SchemaCatalog Catalog(IEnumerable<CatalogColumn> columns)
        => new(columns.Select(c => (c.Schema, c.Table, c.Column, c.DataType)));

    /// <summary>The stored expression tree, or null when the JSON cannot be read.</summary>
    public static MeasureNode? ReadMeasure(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<MeasureNode>(json, MeasureNode.JsonOptions);
        }
        // A stored {} has no kind and throws NotSupportedException for the abstract base.
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            return null;
        }
    }

    /// <summary>The stored hidden columns, or none when there are none or the JSON cannot be read.</summary>
    public static IReadOnlyList<string> ReadHidden(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    /// <summary>The tree sent in a request, or null when it is missing or cannot be read.</summary>
    public static MeasureNode? ReadMeasure(JsonElement json)
        => json.ValueKind == JsonValueKind.Object ? ReadMeasure(json.GetRawText()) : null;

    /// <summary>
    /// The compiler's view of a dataset: its sources, active relationships, calculated columns and
    /// transforms (in the order they apply), with the given measures. A calculated column whose tree
    /// cannot be read keeps a null expression, so only a query that uses it is refused.
    /// </summary>
    public static DatasetModel ToModel(DatasetParts parts, IReadOnlyList<ModelMeasure> measures) => new(
        parts.Sources.Select(s => new ModelSource(s.Id, s.Alias, s.SchemaName, s.SourceName, s.RlsMode, s.RlsPlantColumn)).ToList(),
        parts.Relationships.Where(r => r.IsActive)
            .Select(r => new ModelRelationship(r.Id, r.FromSourceId, r.FromColumn, r.ToSourceId, r.ToColumn, r.Cardinality)).ToList(),
        measures,
        parts.CalculatedColumns.Select(c => new ModelCalculatedColumn(c.SourceId, c.Name, ReadMeasure(c.ExpressionAst))).ToList(),
        parts.Transforms.OrderBy(t => t.SortOrder).ThenBy(t => t.Id)
            .Select(t => new ModelTransform(t.SourceId, t.ColumnName, t.Kind, TransformValue(t.ConfigJson), TransformOptions(t.ConfigJson))).ToList());

    /// <summary>The "value" of a transform's configuration, or null when it has none or cannot be read.</summary>
    public static string? TransformValue(string configJson)
    {
        try
        {
            using var document = JsonDocument.Parse(configJson);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A transform's settings other than its value: every text property of its configuration but "value", or null when there are none.</summary>
    public static IReadOnlyDictionary<string, string>? TransformOptions(string configJson)
    {
        try
        {
            using var document = JsonDocument.Parse(configJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return null;
            var options = document.RootElement.EnumerateObject()
                .Where(p => p.Name != "value" && p.Value.ValueKind == JsonValueKind.String)
                .ToDictionary(p => p.Name, p => p.Value.GetString()!);
            return options.Count > 0 ? options : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// A new table source, spelled as the catalogue spells it, with its row filter applied. connectionId is the
    /// connection the table is read from when it is not the data model's own, otherwise null.
    /// </summary>
    public static Result<DatasetSource> NewSource(
        long datasetId, AddSourceRequest request, IReadOnlyList<CatalogColumn> columns, IReadOnlyList<DatasetSource> existing,
        long? connectionId = null)
    {
        var table = columns.FirstOrDefault(c => Same(c.Schema, request.SchemaName) && Same(c.Table, request.SourceName));
        if (table is null)
            return Result<DatasetSource>.ValidationError(
                $"The table {request.SchemaName}.{request.SourceName} does not exist on this connection. Sync the connection's schema and try again.");
        if (existing.Any(s => Same(s.Alias, request.Alias)))
            return Result<DatasetSource>.Conflict($"This data model already has a table called \"{request.Alias}\".");
        // ponytail: columns are found by schema and table name only (SchemaCatalog), so one name may come from one database.
        // Key the catalogue by database as well if models need the same table name from two databases.
        if (existing.Any(s => s.SourceKind == "table" && s.ConnectionId != connectionId && Same(s.SchemaName, table.Schema) && Same(s.SourceName, table.Table)))
            return Result<DatasetSource>.Conflict(
                $"This data model already reads a table called {table.Schema}.{table.Table} from another database. A data model can hold a table name from one database only.");

        var source = new DatasetSource
        {
            DatasetId = datasetId, SourceKind = "table", SchemaName = table.Schema, SourceName = table.Table, Alias = request.Alias,
            ConnectionId = connectionId,
        };
        return ApplyRls(source, request.RlsMode, request.RlsPlantColumn, columns);
    }

    /// <summary>A new view source. The view must pass the view contract now, and its row filter uses a column of the view's own output.</summary>
    public static Result<DatasetSource> NewViewSource(
        long datasetId, AddSourceRequest request, PreparedView? view, IReadOnlyList<DatasetSource> existing)
    {
        if (view is null)
            return Result<DatasetSource>.ValidationError("The view does not exist on this data model's connection.");
        if (!view.IsUsable)
            return Result<DatasetSource>.ValidationError($"The view {view.Name} cannot be added. {view.Problems.FirstOrDefault()}");
        if (existing.Any(s => Same(s.Alias, request.Alias)))
            return Result<DatasetSource>.Conflict($"This data model already has a table called \"{request.Alias}\".");
        // Sources of one view share its catalogue entries, so they must hold the same SQL.
        if (existing.FirstOrDefault(s => s.SourceKind == "view" && s.SourceName == ViewSource.Key(view.Id) && s.ViewSql != view.Sql!.Sql) is { } older)
            return Result<DatasetSource>.Conflict(
                $"{older.Alias} already reads this view as it was when it was added. Update {older.Alias} from its view first.");

        var source = new DatasetSource
        {
            DatasetId = datasetId, SourceKind = "view", SchemaName = ViewSource.Schema, SourceName = ViewSource.Key(view.Id), Alias = request.Alias,
            ViewSql = view.Sql!.Sql,
        };
        return ApplyRls(source, request.RlsMode, request.RlsPlantColumn, ViewSource.CatalogColumns(view).ToList());
    }

    /// <summary>
    /// A new script source: a view that fails the view contract and runs as written (ScriptSource.Check). It keeps the
    /// view's batch as saved, and its row filter uses a column of the batch's output.
    /// </summary>
    public static Result<DatasetSource> NewScriptSource(
        long datasetId, AddSourceRequest request, PreparedView? view, IReadOnlyList<DatasetSource> existing)
    {
        if (view is null)
            return Result<DatasetSource>.ValidationError("The view does not exist on this data model's connection.");
        if (view.Script is not { } script)
            return Result<DatasetSource>.ValidationError($"The view {view.Name} can be added as a view. Add it that way.");
        if (!script.IsUsable)
            return Result<DatasetSource>.ValidationError($"The view {view.Name} cannot run as written. {script.Problems.FirstOrDefault()}");
        if (existing.Any(s => Same(s.Alias, request.Alias)))
            return Result<DatasetSource>.Conflict($"This data model already has a table called \"{request.Alias}\".");
        // Sources of one view share its catalogue entries, so they must hold the same batch.
        if (existing.FirstOrDefault(s => s.SourceKind == ScriptSource.Kind && s.SourceName == ViewSource.Key(view.Id) && s.ViewSql != script.Text) is { } older)
            return Result<DatasetSource>.Conflict(
                $"{older.Alias} already reads this view as it was when it was added. Update {older.Alias} from its view first.");

        var source = new DatasetSource
        {
            DatasetId = datasetId, SourceKind = ScriptSource.Kind, SchemaName = ScriptSource.Schema, SourceName = ViewSource.Key(view.Id),
            Alias = request.Alias, ViewSql = script.Text,
        };
        return ApplyRls(source, request.RlsMode, request.RlsPlantColumn, ScriptSource.CatalogColumns(source.SourceName, script.Columns).ToList());
    }

    /// <summary>
    /// Sets who sees which rows: plant filters by the column holding the plant code, none lets
    /// everyone see all rows. The source is only changed when the choice is valid.
    /// </summary>
    public static Result<DatasetSource> ApplyRls(DatasetSource source, string rlsMode, string? plantColumn, IReadOnlyList<CatalogColumn> columns)
    {
        if (rlsMode == "none")
        {
            source.RlsMode = "none";
            source.RlsPlantColumn = null;
            return Result<DatasetSource>.Success(source);
        }

        var canonical = plantColumn is null ? null : Catalog(columns).Column(source.SchemaName, source.SourceName, plantColumn);
        if (rlsMode != "plant" || canonical is null)
            return Result<DatasetSource>.ValidationError(
                $"Choose the column of {source.Alias} that holds the plant code, or let everyone see all rows.");

        source.RlsMode = "plant";
        source.RlsPlantColumn = canonical;
        return Result<DatasetSource>.Success(source);
    }

    /// <summary>A new relationship between two tables of the dataset, spelled as the catalogue spells it.</summary>
    public static Result<DatasetRelationship> NewRelationship(
        long datasetId, AddRelationshipRequest request, IReadOnlyList<DatasetSource> sources,
        IReadOnlyList<CatalogColumn> columns, IReadOnlyList<DatasetRelationship> existing)
    {
        var from = sources.FirstOrDefault(s => s.Id == request.FromSourceId);
        var to = sources.FirstOrDefault(s => s.Id == request.ToSourceId);
        if (from is null || to is null)
            return Result<DatasetRelationship>.ValidationError("Both tables must be part of this data model.");
        if (from.Id == to.Id)
            return Result<DatasetRelationship>.ValidationError("A table cannot be related to itself.");

        var catalog = Catalog(columns);
        var fromColumn = catalog.Column(from.SchemaName, from.SourceName, request.FromColumn);
        if (fromColumn is null)
            return Result<DatasetRelationship>.ValidationError($"{from.Alias} has no column called \"{request.FromColumn}\".");
        var toColumn = catalog.Column(to.SchemaName, to.SourceName, request.ToColumn);
        if (toColumn is null)
            return Result<DatasetRelationship>.ValidationError($"{to.Alias} has no column called \"{request.ToColumn}\".");

        if (existing.Any(e => Joins(e, from.Id, fromColumn, to.Id, toColumn)))
            return Result<DatasetRelationship>.Conflict($"{from.Alias}.{fromColumn} and {to.Alias}.{toColumn} are already related.");

        return Result<DatasetRelationship>.Success(new DatasetRelationship
        {
            DatasetId = datasetId, FromSourceId = from.Id, FromColumn = fromColumn, ToSourceId = to.Id, ToColumn = toColumn,
            Cardinality = request.Cardinality, IsActive = true, DetectedFrom = request.DetectedFrom,
        });
    }

    /// <summary>
    /// Foreign keys in core.DatabaseSchema that join two tables of the dataset and are not added yet.
    /// The foreign key column is the many side and the column it references the one side.
    /// </summary>
    public static IReadOnlyList<RelationshipSuggestionDto> SuggestRelationships(
        IReadOnlyList<DatasetSource> sources, IReadOnlyList<CatalogColumn> columns, IReadOnlyList<DatasetRelationship> existing)
    {
        var suggestions = new List<RelationshipSuggestionDto>();
        foreach (var from in sources)
        foreach (var fk in columns.Where(c => c.IsForeignKey && c.ForeignKeyTable is not null && c.ForeignKeyColumn is not null
                                             && Same(c.Schema, from.SchemaName) && Same(c.Table, from.SourceName)))
        foreach (var to in sources.Where(s => s.Id != from.Id && Same(s.SourceName, fk.ForeignKeyTable)
                                             && (fk.ForeignKeySchema is null || Same(s.SchemaName, fk.ForeignKeySchema))))
        {
            if (!existing.Any(e => Joins(e, from.Id, fk.Column, to.Id, fk.ForeignKeyColumn!)))
                suggestions.Add(new RelationshipSuggestionDto(from.Id, fk.Column, to.Id, fk.ForeignKeyColumn!, "many_to_one"));
        }
        return suggestions;
    }

    // Admin scope: the rules check a formula, not who may see its rows.
    private static readonly UserScope Admin = new(true, []);

    /// <summary>
    /// The formula with every [Measure] reference replaced by that measure's own formula, expanded in turn.
    /// A name no measure has, or a measure that reaches itself, is refused with the chain in the message.
    /// </summary>
    public static MeasureNode ExpandRefs(MeasureNode node, string name, Func<string, MeasureNode?> find)
        => Expand(node, [name], find);

    private static MeasureNode Expand(MeasureNode node, IReadOnlyList<string> path, Func<string, MeasureNode?> find) => node switch
    {
        MeasureRefNode r when path.Contains(r.Measure, StringComparer.OrdinalIgnoreCase) => throw new QueryException(QueryErrors.InvalidMeasure,
            $"{string.Join(" uses ", path.Append(r.Measure))}: a measure cannot use itself."),
        MeasureRefNode r => Expand(find(r.Measure) ?? throw new QueryException(QueryErrors.InvalidMeasure,
            $"{path[^1]} uses [{r.Measure}], and this data model has no measure called {r.Measure}."), [.. path, r.Measure], find),
        BinaryNode b => b with { Left = Expand(b.Left, path, find), Right = Expand(b.Right, path, find) },
        CompareNode c => c with { Left = Expand(c.Left, path, find), Right = Expand(c.Right, path, find) },
        FunctionNode f => f with { Args = [.. (f.Args ?? []).Select(a => Expand(a, path, find))] },
        _ => node,
    };

    /// <summary>Finds a stored measure's formula by name, for ExpandRefs; null when there is none or it cannot be read.</summary>
    public static Func<string, MeasureNode?> MeasureLookup(IEnumerable<DatasetMeasure> measures)
    {
        var byName = measures.GroupBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().ExpressionAst, StringComparer.OrdinalIgnoreCase);
        return name => byName.TryGetValue(name, out var json) ? ReadMeasure(json) : null;
    }

    /// <summary>The measures whose formula names the given measure, as [name].</summary>
    public static IReadOnlyList<string> MeasuresUsing(string name, IEnumerable<DatasetMeasure> measures)
        => measures.Where(m => !string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)
                && ReadMeasure(m.ExpressionAst) is { } tree && Refers(tree, name))
            .Select(m => m.Name).ToList();

    private static bool Refers(MeasureNode node, string name) => node switch
    {
        MeasureRefNode r => string.Equals(r.Measure, name, StringComparison.OrdinalIgnoreCase),
        BinaryNode b => Refers(b.Left, name) || Refers(b.Right, name),
        CompareNode c => Refers(c.Left, name) || Refers(c.Right, name),
        FunctionNode f => (f.Args ?? []).Any(a => Refers(a, name)),
        _ => false,
    };

    /// <summary>
    /// Checks a measure by compiling a query that asks for it alone, so the compiler's rules are the
    /// measure rules: known columns (calculated ones included), an aggregate, related tables, no fan
    /// trap. On success the value is the tree re-serialised, which puts "kind" first as the reader requires.
    /// </summary>
    public static Result<string> CheckMeasure(
        long datasetId, string name, MeasureNode expression, IReadOnlyList<DatasetSource> sources,
        IReadOnlyList<DatasetRelationship> relationships, IReadOnlyList<CatalogColumn> columns,
        IReadOnlyList<DatasetCalculatedColumn>? calculated = null, IReadOnlyList<DatasetTransform>? transforms = null,
        IReadOnlyList<DatasetMeasure>? measures = null)
    {
        if (PrintableFormulaProblem(name, expression) is { } tooLong) return Result<string>.ValidationError(tooLong);
        try
        {
            // [Measure] references are checked as the query will run them: with each named formula in place.
            var expanded = ExpandRefs(expression, name, MeasureLookup(measures ?? []));
            var model = ToModel(new DatasetParts([.. sources], [.. relationships], [], [.. calculated ?? []], [.. transforms ?? []]),
                [new ModelMeasure(name, expanded)]);
            QueryCompiler.Compile(model, new QueryRequest(datasetId, [], [name]), Admin, Catalog(columns));
        }
        catch (QueryException ex)
        {
            return Result<string>.ValidationError(ex.Message);
        }

        return FormulaProblem(name, expression) is { } problem
            ? Result<string>.ValidationError(problem)
            : Result<string>.Success(JsonSerializer.Serialize(expression, MeasureNode.JsonOptions));
    }

    /// <summary>
    /// A calculated column of source, checked by compiling a query that groups by it alone, so the
    /// compiler's rules are the column rules. Others holds the rest of the dataset: for an update, every
    /// calculated column but the one being changed. The result carries the normalised tree, its printed
    /// text and its type; it is not stored yet.
    /// </summary>
    public static Result<DatasetCalculatedColumn> NewCalculatedColumn(
        long datasetId, DatasetSource source, string name, MeasureNode expression, DatasetParts others, IReadOnlyList<CatalogColumn> columns)
    {
        if (others.CalculatedColumns.Any(c => c.SourceId == source.Id && Same(c.Name, name)))
            return Result<DatasetCalculatedColumn>.Conflict($"{source.Alias} already has a calculated column called \"{name}\".");
        if (Catalog(columns).Column(source.SchemaName, source.SourceName, name) is { } taken)
            return Result<DatasetCalculatedColumn>.ValidationError($"{source.Alias} already has a column called \"{taken}\". Choose another name.");
        if (PrintableFormulaProblem(name, expression) is { } tooLong) return Result<DatasetCalculatedColumn>.ValidationError(tooLong);

        var column = new DatasetCalculatedColumn
        {
            DatasetId = datasetId, SourceId = source.Id, Name = name,
            ExpressionAst = JsonSerializer.Serialize(expression, MeasureNode.JsonOptions),
            DataType = ColumnKind(expression, source, others, columns),
        };
        try
        {
            QueryCompiler.Compile(ToModel(others with { CalculatedColumns = [.. others.CalculatedColumns, column] }, []),
                new QueryRequest(datasetId, [$"{source.Alias}.{name}"], []), Admin, Catalog(columns));
        }
        catch (QueryException ex)
        {
            return Result<DatasetCalculatedColumn>.ValidationError(ex.Message);
        }
        if (FormulaProblem(name, expression) is { } problem) return Result<DatasetCalculatedColumn>.ValidationError(problem);

        // The tree is the source of truth; the text is printed from it and never read back here.
        column.ExpressionText = MeasureText.Print(expression);
        return Result<DatasetCalculatedColumn>.Success(column);
    }

    /// <summary>
    /// A transform of one of the source's own table columns, spelled as the catalogue spells it and
    /// placed after the source's other transforms. Checked by compiling a query that groups by the column
    /// with the transform applied. Never the plant column, which must be read as stored.
    /// </summary>
    public static Result<DatasetTransform> NewTransform(
        long datasetId, DatasetSource source, AddTransformRequest request, DatasetParts parts, IReadOnlyList<CatalogColumn> columns)
    {
        var column = Catalog(columns).Column(source.SchemaName, source.SourceName, request.Column);
        if (column is null)
            return Result<DatasetTransform>.ValidationError(
                parts.CalculatedColumns.Any(c => c.SourceId == source.Id && Same(c.Name, request.Column))
                    ? $"{source.Alias}.{request.Column} is a calculated column. Change its formula instead of adding a transform."
                    : $"{source.Alias} has no column called \"{request.Column}\".");
        if (source.RlsMode == "plant" && Same(source.RlsPlantColumn, column))
            return Result<DatasetTransform>.ValidationError($"{source.Alias}.{column} decides who sees which rows, so a transform cannot change it.");

        var transform = new DatasetTransform
        {
            DatasetId = datasetId, SourceId = source.Id, ColumnName = column, Kind = request.Kind,
            ConfigJson = Config(request),
            SortOrder = parts.Transforms.Where(t => t.SourceId == source.Id).Select(t => t.SortOrder).DefaultIfEmpty(0).Max() + 1,
        };
        try
        {
            QueryCompiler.Compile(ToModel(parts with { Transforms = [.. parts.Transforms, transform] }, []),
                new QueryRequest(datasetId, [$"{source.Alias}.{column}"], []), Admin, Catalog(columns));
        }
        catch (QueryException ex)
        {
            return Result<DatasetTransform>.ValidationError(ex.Message);
        }
        return Result<DatasetTransform>.Success(transform);
    }

    // trim needs nothing. The others keep their value first, then their settings, as one flat JSON object.
    private static string Config(AddTransformRequest request)
    {
        if (request.Kind == "trim") return "{}";
        var config = new Dictionary<string, string?> { ["value"] = request.Value };
        foreach (var (key, value) in request.Options ?? new Dictionary<string, string>()) config[key] = value;
        return JsonSerializer.Serialize(config);
    }

    // The kind stored for a calculated column: the formula's result type, reading table columns as the catalogue types
    // them after their type transforms, as the compiler does, and the stored kind of the table's other calculated columns.
    private static string ColumnKind(MeasureNode expression, DatasetSource source, DatasetParts others, IReadOnlyList<CatalogColumn> columns)
    {
        var catalog = Catalog(columns);
        static string? Stored(string? kind) => kind switch { "text" => "nvarchar", "date" => "date", "number" => "decimal", _ => null };
        string? TypeOf(ColumnNode column)
        {
            if (catalog.DataType(source.SchemaName, source.SourceName, column.Column) is not { } type)
                return Stored(others.CalculatedColumns.FirstOrDefault(c => c.SourceId == source.Id && Same(c.Name, column.Column))?.DataType);
            foreach (var retype in others.Transforms.Where(t => t.SourceId == source.Id && t.Kind == "type" && Same(t.ColumnName, column.Column))
                         .OrderBy(t => t.SortOrder).ThenBy(t => t.Id))
                type = QueryCompiler.RetypedTo(TransformValue(retype.ConfigJson)) ?? type;
            return type;
        }
        return QueryCompiler.Kind(QueryCompiler.ResultType(expression, TypeOf));
    }

    private const int MaxFormulaLength = 2000;

    /// <summary>
    /// Why a formula breaks the limits of the browser's formula text (plan decision P3-7), or null. Every
    /// saved tree must print as text the browser can read back unchanged.
    /// </summary>
    private static string? FormulaProblem(string name, MeasureNode expression)
    {
        if (Numbers(expression).Select(n => MeasureText.Print(n)).FirstOrDefault(TooPrecise) is { } number)
            return $"{name} uses the number {number}. A number can have at most 15 digits, and at most 6 after the decimal point.";
        if (MeasureText.Print(expression).Length is var length and > MaxFormulaLength)
            return $"The formula of {name} is {length} characters long. A formula can be at most {MaxFormulaLength} characters long.";
        return null;
    }

    // FormulaProblem before compiling, so a formula past the limits is never expanded. A tree that cannot be printed is
    // left to the compiler, whose message says what is wrong with it.
    private static string? PrintableFormulaProblem(string name, MeasureNode expression)
    {
        try
        {
            return FormulaProblem(name, expression);
        }
        catch (Exception ex) when (ex is ArgumentException or NullReferenceException)
        {
            return null;
        }
    }

    private static IEnumerable<NumberNode> Numbers(MeasureNode node) => node switch
    {
        NumberNode n => [n],
        BinaryNode b => Numbers(b.Left).Concat(Numbers(b.Right)),
        FunctionNode f => f.Args.SelectMany(Numbers),
        CompareNode c => Numbers(c.Left).Concat(Numbers(c.Right)),
        _ => [],
    };

    // Same rule as numberLiteralProblem in the browser: leading zeros of the whole part do not count.
    private static bool TooPrecise(string printed)
    {
        var parts = printed.TrimStart('-').Split('.');
        var whole = parts[0].TrimStart('0') is { Length: > 0 } digits ? digits : "0";
        var fraction = parts.Length > 1 ? parts[1] : "";
        return whole.Length + fraction.Length > 15 || fraction.Length > 6;
    }

    /// <summary>
    /// The first stored measure that does not compile against these sources and relationships,
    /// with the compiler's reason, or null when every one does. Measures whose JSON cannot be read
    /// are skipped.
    /// </summary>
    public static (string Name, string Reason)? FirstBrokenMeasure(
        IReadOnlyList<DatasetSource> sources, IReadOnlyList<DatasetRelationship> relationships,
        IReadOnlyList<CatalogColumn> columns, IEnumerable<DatasetMeasure> measures,
        IReadOnlyList<DatasetCalculatedColumn>? calculated = null, IReadOnlyList<DatasetTransform>? transforms = null,
        IReadOnlyList<DatasetMeasure>? all = null)
    {
        var list = measures.ToList();
        foreach (var measure in list)
        {
            if (ReadMeasure(measure.ExpressionAst) is not { } expression) continue;
            var check = CheckMeasure(measure.DatasetId, measure.Name, expression, sources, relationships, columns, calculated, transforms,
                all ?? list);
            if (!check.IsSuccess) return (measure.Name, check.ErrorMessage!);
        }
        return null;
    }

    /// <summary>
    /// The first of the candidates that does not compile against these parts, or null when every one does.
    /// Calculated columns whose JSON cannot be read are skipped, as unreadable measures are.
    /// </summary>
    public static DatasetCalculatedColumn? FirstBrokenColumn(
        DatasetParts parts, IReadOnlyList<CatalogColumn> columns, IEnumerable<DatasetCalculatedColumn> candidates)
    {
        var model = ToModel(parts, []);
        var catalog = Catalog(columns);
        foreach (var column in candidates)
        {
            if (ReadMeasure(column.ExpressionAst) is null) continue;
            if (parts.Sources.FirstOrDefault(s => s.Id == column.SourceId) is not { } source) return column;
            try
            {
                QueryCompiler.Compile(model, new QueryRequest(column.DatasetId, [$"{source.Alias}.{column.Name}"], []), Admin, catalog);
            }
            catch (QueryException)
            {
                return column;
            }
        }
        return null;
    }

    /// <summary>
    /// True when a data model may be built on the connection: any active SQL Server connection of the tenant.
    /// Its views come from this connection; a table may also come from another database on the same server (CannotJoin).
    /// </summary>
    public static bool CanHostDataset(DatabaseConnection connection)
        => connection.IsActive && !connection.IsDeleted && Same(connection.Provider, "mssql");

    /// <summary>
    /// Why a table of the other connection cannot be read by a data model on the model connection, or null when it can:
    /// the other must be an active SQL Server connection on the same server and port, so that one query reads both
    /// databases with three-part names.
    /// </summary>
    // ponytail: the server is compared as typed on each connection, so localhost and 127.0.0.1 count as two servers.
    public static string? CannotJoin(DatabaseConnection model, DatabaseConnection other)
    {
        if (other.Id == model.Id) return null;
        if (!CanHostDataset(other)) return $"{other.DatabaseName} is not an active SQL Server connection.";
        return Same(other.Server.Trim(), model.Server.Trim()) && other.Port == model.Port
            ? null
            : $"{other.DatabaseName} is on {other.Server},{other.Port} and this data model reads {model.DatabaseName} on {model.Server},{model.Port}. " +
              "Tables of two databases can be joined only when both are on the same server.";
    }

    /// <summary>
    /// True when the connection is the tenant database itself, where uploaded files are loaded. False when the
    /// tenant database name is not known.
    /// </summary>
    public static bool IsTenantDatabase(DatabaseConnection connection, string? tenantDatabase)
        => !string.IsNullOrWhiteSpace(tenantDatabase) && Same(connection.DatabaseName, tenantDatabase);

    /// <summary>True when the relationship joins these two columns, in either direction.</summary>
    private static bool Joins(DatasetRelationship r, long a, string aColumn, long b, string bColumn)
        => (r.FromSourceId == a && Same(r.FromColumn, aColumn) && r.ToSourceId == b && Same(r.ToColumn, bColumn))
        || (r.FromSourceId == b && Same(r.FromColumn, bColumn) && r.ToSourceId == a && Same(r.ToColumn, aColumn));

    private static bool Same(string? a, string? b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
