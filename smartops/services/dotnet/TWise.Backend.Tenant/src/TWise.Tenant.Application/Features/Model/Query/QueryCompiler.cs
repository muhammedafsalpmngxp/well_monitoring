using System.Globalization;
using TWise.Tenant.Application.Features.Model.Datasets;

namespace TWise.Tenant.Application.Features.Model.Query;

/// <summary>
/// Compiles a dataset model and a query request into one parameterised SELECT, after the batches of any saved
/// views it reads (ScriptSource).
/// Pure: no I/O, so every behaviour is pinned by golden SQL tests.
/// Identifiers are checked against the schema catalogue and bracket-quoted; values are always
/// parameters. The row-level security predicate is part of every query, not an add-on.
/// A source with calculated columns or transforms is read through one CTE, named by its alias, that
/// applies them. Every other source is read from its table.
/// </summary>
public static class QueryCompiler
{
    public const int DefaultTopN = 5000;
    public const int MaxTopN = 10000;

    /// <summary>How many levels deep calculated columns may build on each other.</summary>
    public const int MaxColumnDepth = 8;

    /// <summary>
    /// The most SQL one calculated column may write out to, with the columns it builds on. SPLIT repeats its text,
    /// so a short formula or a chain of columns could otherwise grow without limit.
    /// </summary>
    public const int MaxRowSqlLength = 100_000;

    /// <summary>
    /// The last column of a query with totals: GROUPING_ID of the dimensions, in their order. Its bit for a
    /// dimension (the highest bit for the first) is set on a row that totals over that dimension, so 0 is a
    /// detail row and all bits set is the grand total.
    /// </summary>
    public const string LevelColumn = "__level";

    // SQL Server allows 2,100 parameters per command; leave room for RLS and the rest.
    private const int MaxInValues = 1000;
    private const int MaxParameters = 2000;

    // SQL Server's limit on an identifier, which includes a column alias.
    private const int MaxNameLength = 128;

    // These return the same answer however many times a join repeats a row.
    private static readonly HashSet<string> FanSafeAggregates = new(StringComparer.OrdinalIgnoreCase) { "count_distinct", "min", "max" };

    /// <summary>A column as the query reads it. Type is its SQL Server type name, or null when it is not known.</summary>
    /// <summary>
    /// A column the query reads. Part, when set, is a level of a date hierarchy the query groups and filters by instead
    /// of the date itself: year, quarter (2026 Q1), month (its first day) or day; the field is then written column@part.
    /// </summary>
    private sealed record Field(ModelSource Source, string Column, string? Type, string? Part = null)
    {
        public string Name => Part is null ? $"{Source.Alias}.{Column}" : $"{Source.Alias}.{Column}@{Part}";

        public string Sql => Part switch
        {
            null => Plain,
            "year" => $"YEAR({Plain})",
            "quarter" => $"CONCAT(YEAR({Plain}), ' Q', DATEPART(quarter, {Plain}))",
            "month" => $"DATEFROMPARTS(YEAR({Plain}), MONTH({Plain}), 1)",
            _ => $"CAST({Plain} AS date)",
        };

        private string Plain => $"{Quote(Source.Alias)}.{Quote(Column)}";
    }

    private static readonly string[] DateParts = ["year", "quarter", "month", "day"];

    /// <summary>
    /// How the measure functions go along the rows: ORDER BY the query's first field, PARTITION BY the others.
    /// PartitionBy is empty or ends with a space. First is the first field, null without one; YTD needs it to be a date.
    /// </summary>
    private sealed record Window(string OrderBy, string PartitionBy, Field? First = null);

    /// <summary>
    /// The names one compilation resolves. Resolve records each column the outer query reads, so a source
    /// read through a CTE selects exactly those columns.
    /// </summary>
    private sealed class Scope(DatasetModel model, SchemaCatalog catalog)
    {
        public Dictionary<string, ModelSource> ByAlias { get; } = model.Sources.ToDictionary(s => s.Alias, StringComparer.OrdinalIgnoreCase);

        public ILookup<long, ModelCalculatedColumn> Calculated { get; } = (model.CalculatedColumns ?? []).ToLookup(c => c.SourceId);

        public ILookup<long, ModelTransform> Transforms { get; } = (model.Transforms ?? []).ToLookup(t => t.SourceId);

        /// <summary>Per source id, the columns the outer query reads, in the order it first reads them.</summary>
        public Dictionary<long, List<string>> Used { get; } = new();

        /// <summary>Per script source the query reads, the temporary table its batch fills: #s0, #s1, ...</summary>
        public Dictionary<long, string> Temps { get; } = new();

        public bool HasCte(ModelSource source) => Calculated[source.Id].Any() || Transforms[source.Id].Any();

        public Field Resolve(string alias, string column)
        {
            if (!ByAlias.TryGetValue(alias, out var source))
                throw new QueryException(QueryErrors.UnknownField, $"There is no source called \"{alias}\" in this data model.");
            var field = Column(source, column);
            if (!Used.TryGetValue(source.Id, out var used)) Used[source.Id] = used = [];
            if (!used.Contains(field.Column)) used.Add(field.Column);
            return field;
        }

        /// <summary>The rows of a source, for COUNTROWS. It reads no column, so nothing is recorded as read.</summary>
        public Field Rows(string alias) => ByAlias.TryGetValue(alias, out var source)
            ? new Field(source, "*", null)
            : throw new QueryException(QueryErrors.UnknownField, $"There is no source called \"{alias}\" in this data model.");

        /// <summary>A table column or a calculated column of the source. Nothing is recorded as read.</summary>
        public Field Column(ModelSource source, string column)
        {
            var canonical = catalog.Column(source.SchemaName, source.SourceName, column);
            var calculated = CalculatedNamed(source, column);
            if (canonical is not null && calculated is not null)
                throw new QueryException(QueryErrors.InvalidColumn,
                    $"{source.Alias} has a column and a calculated column both called \"{column}\". Rename the calculated column.");
            if (calculated is not null) return new Field(source, calculated.Name, ResultType(calculated.Expression));
            if (canonical is null) throw new QueryException(QueryErrors.UnknownField, $"{source.Alias} has no column called \"{column}\".");
            return new Field(source, canonical, TypeOf(source, canonical));
        }

        public ModelCalculatedColumn? CalculatedNamed(ModelSource source, string? name)
            => Calculated[source.Id].FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));

        public string? CatalogType(ModelSource source, string column) => catalog.DataType(source.SchemaName, source.SourceName, column);

        /// <summary>A table column's type as the query reads it: the catalogue's, changed by each of its type transforms in order.</summary>
        public string? TypeOf(ModelSource source, string column)
        {
            var type = CatalogType(source, column);
            foreach (var transform in Transforms[source.Id].Where(t => t.Kind == "type" && string.Equals(t.Column, column, StringComparison.OrdinalIgnoreCase)))
                type = RetypedTo(transform.Value) ?? type;
            return type;
        }
    }

    /// <summary>
    /// The SQL Server type a calculated column's formula gives, decided by its outer operation: decimal for
    /// arithmetic and the number functions, int for the date parts, LEN and conditions, nvarchar for the text
    /// functions, date for TO_DATE, MONTH_START and TODAY, and the first known part for IF, COALESCE, ISNULL,
    /// IFERROR, MIN_OF and MAX_OF. columnType gives a column's type when it is known; without it a column's
    /// type is null. Null means not known.
    /// </summary>
    public static string? ResultType(MeasureNode? node, Func<ColumnNode, string?>? columnType = null) => node switch
    {
        BinaryNode => "decimal",
        CompareNode => "int",
        NumberNode => "decimal",
        TextNode => "nvarchar",
        ColumnNode c => columnType?.Invoke(c),
        FunctionNode { Fn: not null } f => f.Fn.ToLowerInvariant() switch
        {
            "year" or "month" or "day" or "quarter" or "weekday" or "len" => "int",
            "and" or "or" or "not" or "isblank" or "contains" or "starts_with" or "ends_with" => "int",
            "datediff" => f.Args is [_, _, TextNode { Value: var unit }] && string.Equals(unit, "weeks", StringComparison.OrdinalIgnoreCase)
                ? "decimal" : "int",
            "round" or "abs" or "floor" or "ceiling" or "to_number" => "decimal",
            "concat" or "left" or "right" or "upper" or "lower" or "trim" or "replace" or "substring" or "split"
                or "first_word" or "last_word" or "month_name" or "weekday_name" => "nvarchar",
            "to_date" or "month_start" or "today" => "date",
            "if" => FirstKnown(f.Args?.Skip(1), columnType),
            "coalesce" or "isnull" or "iferror" or "min_of" or "max_of" => FirstKnown(f.Args, columnType),
            _ => null,
        },
        _ => null,
    };

    private static string? FirstKnown(IEnumerable<MeasureNode>? parts, Func<ColumnNode, string?>? columnType)
        => parts?.Select(part => ResultType(part, columnType)).FirstOrDefault(type => type is not null);

    /// <summary>What a calculated column is stored as: date, text or number. A type that is not known is stored as number, as before.</summary>
    public static string Kind(string? type) => type is null ? "number" : IsDate(type) ? "date" : IsText(type) ? "text" : "number";

    public static CompiledQuery Compile(DatasetModel model, QueryRequest request, UserScope user, SchemaCatalog catalog)
    {
        // Request fields arrive from JSON, so any of them can be null.
        var requestedDimensions = request.Dimensions ?? [];
        var requestedMeasures = request.Measures ?? [];
        if (requestedDimensions.Count == 0 && requestedMeasures.Count == 0)
            throw new QueryException(QueryErrors.EmptyRequest, "Choose at least one field or measure.");

        var scope = new Scope(model, catalog);
        var parameters = new Dictionary<string, object>();
        string Param(object value)
        {
            var name = "@p" + parameters.Count;
            parameters[name] = value;
            return name;
        }

        var dimensions = requestedDimensions.Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(f => ResolveField(f, scope)).ToList();

        var measures = requestedMeasures.Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(name => model.Measures.FirstOrDefault(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? throw new QueryException(QueryErrors.UnknownField, $"The measure \"{name}\" does not exist in this data model."))
            .ToList();

        if (request.Totals)
        {
            if (dimensions.Count == 0 || measures.Count == 0)
                throw new QueryException(QueryErrors.InvalidTotals, "Totals need at least one field to group by and one measure to add up.");
            // The totals order keeps each subtotal next to its rows; another sort would pull them apart.
            if (request.Sort is not null)
                throw new QueryException(QueryErrors.InvalidTotals, "A query with totals is sorted by its fields, so it cannot be sorted another way.");
            // ROLLUP's subtotal rows are grouped rows too, so a window would add them in with the detail rows.
            if (measures.Select(m => (Measure: m, Fn: WindowIn(m.Expression))).FirstOrDefault(m => m.Fn is not null) is { Fn: { } across } windowed)
                throw new QueryException(QueryErrors.InvalidTotals,
                    $"{windowed.Measure.Name} uses {across.ToUpperInvariant()}, which reads the other rows of the query, so it cannot be shown with totals. Turn totals off or remove {windowed.Measure.Name}.");
        }

        var dimensionList = string.Join(", ", dimensions.Select(d => d.Sql));

        var aggregates = measures
            .SelectMany(m => AggregatesOf(m.Expression, m.Name).Select(a => (Measure: m, Aggregate: a,
                Field: IsCountRows(a) ? scope.Rows(a.Arg.Source) : scope.Resolve(a.Arg.Source, a.Arg.Column))))
            .ToList();

        // RUNNING_TOTAL and CHANGE go along the query's first field, starting again for each value of the others.
        // Without a field there is one row, so they read that row alone.
        var window = new Window(
            dimensions.Count > 0 ? dimensions[0].Sql : "(SELECT NULL)",
            dimensions.Count > 1 ? $"PARTITION BY {string.Join(", ", dimensions.Skip(1).Select(d => d.Sql))} " : "",
            dimensions.Count > 0 ? dimensions[0] : null);

        // Rendered (and so validated) before the join root is picked: a measure with no
        // aggregate at all contributes nothing to "needed", and must not be able to crash
        // the join planner instead of being refused as invalid. Rendered before the filters,
        // so condition values are the first parameters.
        var measureSql = measures.Select(m => (Measure: m, Sql: Render(m.Expression, scope, m.Name, Param, window))).ToList();

        // A filter on a field a saved view's variable is bound to sets that variable instead of filtering rows.
        var (relational, bound, skipped) = ScriptSource.TakeBound(
            dimensions.Select(d => d.Source).Concat(aggregates.Select(a => a.Field.Source)), request.Filters ?? []);
        var filters = relational
            .Select(f => f is { Field: not null, Op: not null } && f.Values?.Contains(null) != true
                ? (Filter: f, Field: ResolveField(f.Field, scope))
                : throw new QueryException(QueryErrors.InvalidFilter, "A filter needs a field, an operator and no empty values."))
            .ToList();

        var needed = dimensions.Select(d => d.Source)
            .Concat(aggregates.Select(a => a.Field.Source))
            .Concat(filters.Select(f => f.Field.Source))
            .Distinct()
            .ToList();

        // Only possible when every requested measure is a constant with no column in it.
        if (needed.Count == 0)
            throw new QueryException(QueryErrors.InvalidMeasure, "A measure must use at least one column.");

        // Every join is a LEFT JOIN, so the root decides which rows survive. Facts sit on the many side:
        // starting from the first measure's source keeps a fact row whose related row is missing, and
        // groups it under a NULL key. Without a measure, the first dimension's source is the root.
        var root = aggregates.Count > 0 ? aggregates[0].Field.Source : needed[0];
        needed = [root, .. needed.Where(s => s != root)];
        var joins = JoinPlanner.Plan(needed, model.Sources, model.Relationships);
        var joined = new List<ModelSource> { root };
        joined.AddRange(joins.Select(j => j.Joined));
        foreach (var script in joined.Where(s => s.Script is not null)) scope.Temps[script.Id] = $"#s{scope.Temps.Count}";

        foreach (var (measure, aggregate, field) in aggregates)
        {
            // COUNT(*) counts the rows the query reads, which are root's: a root row with no match here would count too.
            if (IsCountRows(aggregate) && field.Source != root)
                throw new QueryException(QueryErrors.CountRowsJoined,
                    $"{measure.Name} counts the rows of {field.Source.Alias}, but this query reads its rows from {root.Alias}, so a {root.Alias} row " +
                    $"with no {field.Source.Alias} row would be counted too. Show {measure.Name} first, or count a column of {field.Source.Alias} with COUNT instead.");
            CheckFanTrap(measure, aggregate, field.Source, joins, model.Sources);
        }

        var select = dimensions.Select(d => $"{d.Sql} AS {Quote(d.Name)}")
            .Concat(measureSql.Select(x => $"{x.Sql} AS {Quote(x.Measure.Name)}"))
            .Concat(request.Totals ? [$"GROUPING_ID({dimensionList}) AS {Quote(LevelColumn)}"] : []);

        var lines = new List<string>
        {
            $"SELECT TOP (@top) {string.Join(", ", select)}",
            $"FROM {From(root, scope)}",
        };

        var byId = model.Sources.ToDictionary(s => s.Id);
        foreach (var join in joins)
        {
            var from = scope.Resolve(byId[join.Via.FromSourceId].Alias, join.Via.FromColumn);
            var to = scope.Resolve(byId[join.Via.ToSourceId].Alias, join.Via.ToColumn);
            lines.Add($"LEFT JOIN {From(join.Joined, scope)} ON {from.Sql} = {to.Sql}");
        }

        // Filters and the plant predicate go in WHERE, not in ON, so on a left-joined source they drop
        // the rows with no match there. For a filter that is what the user asked for: a value. For the
        // plant predicate it is deliberately fail-closed: a row whose plant cannot be proven is not shown
        // to a user who is not an administrator.
        var where = filters.Select(f => RenderFilter(f.Field, f.Filter, Param)).ToList();
        where.AddRange(joined.Select(s => RlsPredicate(s, user, scope, Param)).OfType<string>());

        // Rendered once every column the query reads is known, so their values come after the filters'
        // and the plant predicate's.
        var ctes = joined.Where(scope.HasCte).Select(s => RenderCte(s, scope, Param)).ToList();
        var scripts = joined.Where(s => s.Script is not null)
            .Select(s => ScriptSource.Prelude(s, scope.Temps[s.Id], bound.GetValueOrDefault(s.Id), Param)).ToList();
        if (parameters.Count > MaxParameters)
            throw new QueryException(QueryErrors.InvalidFilter, "This query needs too many values. Use fewer filter values or conditions.");
        if (ctes.Count > 0)
            lines.Insert(0, $"WITH {string.Join(",\n", ctes)}");
        if (where.Count > 0)
            lines.Add($"WHERE {string.Join(" AND ", where)}");

        // ROLLUP groups after WHERE, like a plain GROUP BY, so totals only ever add up rows the user may see.
        if (dimensions.Count > 0)
            lines.Add(request.Totals ? $"GROUP BY ROLLUP({dimensionList})" : $"GROUP BY {dimensionList}");

        var columns = dimensions.Select(d => d.Name).Concat(measures.Select(m => m.Name)).ToList();
        if (request.Totals) columns.Add(LevelColumn);
        if (columns.FirstOrDefault(c => c.Length > MaxNameLength) is { } tooLong)
            throw new QueryException(QueryErrors.UnknownField, $"\"{tooLong}\" is too long to use as a result column name. Shorten it to {MaxNameLength} characters.");
        if (columns.GroupBy(c => c, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1) is { } clash)
            throw new QueryException(QueryErrors.UnknownField, $"\"{clash.Key}\" appears more than once in the query. Rename the measure or remove one of them.");
        // Totals first: the grand total, then for each group its subtotal and then its rows, so TOP only ever cuts
        // detail rows at the end and never the total of a group it shows.
        if (request.Totals)
            lines.Add($"ORDER BY {string.Join(", ", dimensions.Select(d => $"GROUPING({d.Sql}) DESC, {d.Sql}"))}");
        else if (request.Sort is { } sort)
        {
            var name = columns.FirstOrDefault(c => string.Equals(c, sort.Field, StringComparison.OrdinalIgnoreCase))
                ?? throw new QueryException(QueryErrors.UnknownField, $"Sort by \"{sort.Field}\" is not possible because it is not in the query.");
            lines.Add($"ORDER BY {Quote(name)}{(sort.Descending ? " DESC" : "")}");
        }

        parameters["@top"] = Math.Clamp(request.TopN ?? DefaultTopN, 1, MaxTopN);
        return new CompiledQuery(Batch(scripts, string.Join("\n", lines)), parameters, columns) { SkippedFilters = skipped };
    }

    /// <summary>
    /// The query after the batches that fill its script sources' temporary tables. NOCOUNT keeps their inserts from
    /// answering with row counts, so the query's rows are the command's first and only result set.
    /// </summary>
    private static string Batch(IReadOnlyList<string> scripts, string query)
        => scripts.Count == 0 ? query : string.Join("\n", ["SET NOCOUNT ON;", .. scripts, query]);

    /// <summary>
    /// The first rows of one source, with the named columns and no grouping, for the Get Data navigator.
    /// It applies no row-level security, so callers show it to administrators only.
    /// </summary>
    public static CompiledQuery Sample(ModelSource source, IReadOnlyList<string> columns, SchemaCatalog catalog, int rows)
    {
        var names = columns
            .Select(c => catalog.Column(source.SchemaName, source.SourceName, c)
                ?? throw new QueryException(QueryErrors.UnknownField, $"{source.Alias} has no column called \"{c}\"."))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (names.Count == 0)
            throw new QueryException(QueryErrors.UnknownField, $"{source.Alias} has no columns to show.");

        var sql = $"SELECT TOP (@top) {string.Join(", ", names.Select(Quote))}\nFROM {Table(source, new Dictionary<long, string> { [source.Id] = "#s0" })} AS {Quote(source.Alias)}";
        // A saved view is sampled with its own defaults, in its own order.
        if (source.Script is not null)
            sql = Batch([ScriptSource.Prelude(source, "#s0", null, _ => throw new InvalidOperationException())], $"{sql}\nORDER BY {Quote(ScriptSource.RowOrder)}");
        return new CompiledQuery(sql, new Dictionary<string, object> { ["@top"] = Math.Clamp(rows, 1, 100) }, names);
    }

    private static Field ResolveField(string field, Scope scope)
    {
        var dot = field?.IndexOf('.') ?? -1;
        if (field is null || dot <= 0)
            throw new QueryException(QueryErrors.UnknownField, $"\"{field}\" is not a field. Fields are written as source.column.");
        var at = field.LastIndexOf('@');
        var part = at > dot ? field[(at + 1)..].ToLowerInvariant() : null;
        if (part is null || !DateParts.Contains(part)) return scope.Resolve(field[..dot], field[(dot + 1)..]);
        var date = scope.Resolve(field[..dot], field[(dot + 1)..at]);
        if (date.Type is null || !IsDate(date.Type))
            throw new QueryException(QueryErrors.UnknownField, $"{date.Name} holds no dates, so it has no {part} level.");
        return date with
        {
            Part = part,
            Type = part switch { "year" => "int", "quarter" => "nvarchar", _ => "date" },
        };
    }

    private static IEnumerable<AggregateNode> AggregatesOf(MeasureNode node, string measure) => node switch
    {
        AggregateNode
        {
            Fn: not null,
            Arg: { Source: not null, Column: not null },
            Where: null or { Column: { Source: not null, Column: not null }, Op: not null, Value: not null },
        } a => [a],
        AggregateNode => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} cannot be read."),
        BinaryNode b => AggregatesOf(b.Left, measure).Concat(AggregatesOf(b.Right, measure)),
        // The calculation inside a measure function; Render refuses any other function.
        FunctionNode { Args: not null } f => f.Args.Where(arg => arg is not null).SelectMany(arg => AggregatesOf(arg, measure)),
        _ => [],
    };

    private static string Render(MeasureNode node, Scope scope, string measure, Func<object, string> param, Window window)
    {
        string Inner(MeasureNode n) => Render(n, scope, measure, param, window);

        return node switch
        {
            AggregateNode a => a.Fn.ToLowerInvariant() switch
            {
                "sum" => $"SUM({NumberCol(a, "Sum")})",
                // 1.0 * avoids integer division when the column is an integer.
                "avg" => $"AVG(1.0 * {NumberCol(a, "Average")})",
                "count" => $"COUNT({Col(a)})",
                "count_distinct" => $"COUNT(DISTINCT {Col(a)})",
                "min" => $"MIN({Col(a)})",
                "max" => $"MAX({Col(a)})",
                // CASE without ELSE gives NULL for the rows that fail the condition, and COUNT skips NULL.
                "count_rows" => a.Where is { } rowsTest ? $"COUNT(CASE WHEN {Condition(a, rowsTest)} THEN 1 END)" : "COUNT(*)",
                _ => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} uses an unknown function \"{a.Fn}\"."),
            },
            NumberNode n => NumberSql(n),
            // A MIN/MAX of a date column returns a date; SQL Server cannot add or divide dates, and date
            // differences are not a feature here. Stays valid as a measure on its own.
            BinaryNode b when (b.Op is "+" or "-" or "*" or "/") && (DateOperand(b.Left) ?? DateOperand(b.Right)) is { } dateField =>
                throw new QueryException(QueryErrors.InvalidMeasure,
                    $"{measure} cannot use {dateField.Name} in a calculation because it holds a date. Use MIN or MAX of a date on its own."),
            // 1.0 * avoids integer division when both sides are integers, as with COUNT / COUNT.
            BinaryNode { Op: "/" } b => $"(1.0 * {Inner(b.Left)} / NULLIF({Inner(b.Right)}, 0))",
            // A side with no matching rows is NULL; in a sum or difference it counts as 0, as users of
            // spreadsheet and DAX-style tools expect. A number is never NULL, so it is left bare.
            BinaryNode { Op: "+" or "-" } b => $"({Blank(b.Left)} {b.Op} {Blank(b.Right)})",
            BinaryNode { Op: "*" } b => $"({Inner(b.Left)} * {Inner(b.Right)})",
            BinaryNode b => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} uses an unknown operator \"{b.Op}\"."),
            FunctionNode { Fn: not null, Args: [var over] } f when IsWindow(f.Fn) && over is not null && f.Fn.ToLowerInvariant() != "moving_avg"
                => Windowed(f.Fn.ToLowerInvariant(), over, 0),
            FunctionNode { Fn: not null, Args: [var over, NumberNode rows] } f when string.Equals(f.Fn, "moving_avg", StringComparison.OrdinalIgnoreCase) && over is not null
                => Windowed("moving_avg", over, rows.Value is >= 2 and <= 366 && decimal.Truncate(rows.Value) == rows.Value
                    ? (int)rows.Value
                    : throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} averages over {rows.Value} rows. Use a whole number from 2 to 366.")),
            FunctionNode { Fn: not null } f when IsWindow(f.Fn) => throw new QueryException(QueryErrors.InvalidMeasure,
                string.Equals(f.Fn, "moving_avg", StringComparison.OrdinalIgnoreCase)
                    ? $"{measure} uses MOVING_AVG with {f.Args?.Count ?? 0} parts. It takes a calculation and a number of rows, as in MOVING_AVG(SUM(table.column), 3)."
                    : $"{measure} uses {f.Fn.ToUpperInvariant()} with {f.Args?.Count ?? 0} parts. It takes one calculation, as in {f.Fn.ToUpperInvariant()}(SUM(table.column))."),
            FunctionNode { Fn: not null, Args: [var scored, NumberNode amber, NumberNode green] } f
                when string.Equals(f.Fn, "threshold", StringComparison.OrdinalIgnoreCase) && scored is not null => Threshold(Inner(scored), amber.Value, green.Value),
            FunctionNode { Fn: not null } f when string.Equals(f.Fn, "threshold", StringComparison.OrdinalIgnoreCase) => throw new QueryException(QueryErrors.InvalidMeasure,
                $"{measure} uses THRESHOLD with {f.Args?.Count ?? 0} parts. It takes a calculation, an amber number and a green number, as in THRESHOLD(SUM(table.column), 50, 80)."),
            FunctionNode f => throw new QueryException(QueryErrors.InvalidMeasure,
                $"{measure} uses {f.Fn?.ToUpperInvariant()}, which works on one row at a time. Add it as a calculated column, then use that column in the measure."),
            TextNode => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} uses text in a calculation. A measure calculates with numbers."),
            ColumnNode c => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} uses {c.Source}.{c.Column} without an aggregate such as sum or count."),
            _ => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} cannot be read."),
        };

        string Blank(MeasureNode n) => n is NumberNode ? Inner(n) : $"COALESCE({Inner(n)}, 0)";

        // 100 at or past green, 50 at or past amber, 0 before it. When green is below amber, lower is better.
        string Threshold(string value, decimal amber, decimal green)
        {
            var (a, g) = (NumberSql(new NumberNode(amber)), NumberSql(new NumberNode(green)));
            var past = green >= amber ? ">=" : "<=";
            return $"(CASE WHEN {value} IS NULL THEN NULL WHEN {value} {past} {g} THEN 100 WHEN {value} {past} {a} THEN 50 ELSE 0 END)";
        }

        // Window functions run after WHERE and GROUP BY, so they read the grouped rows of this query only: the rows
        // the filters and the plant predicate keep. They are computed before TOP cuts the rows.
        string Windowed(string fn, MeasureNode over, int rows)
        {
            if (WindowIn(over) is not null)
                throw new QueryException(QueryErrors.InvalidMeasure,
                    $"{measure} uses {fn.ToUpperInvariant()} around another function that reads other rows. Use one of them at a time.");
            var value = Inner(over);
            var previous = $"LAG({value}) OVER ({window.PartitionBy}ORDER BY {window.OrderBy})";
            return fn switch
            {
                "percent_of_total" => $"(100.0 * {value} / NULLIF(SUM({value}) OVER (), 0))",
                "running_total" => $"SUM({value}) OVER ({window.PartitionBy}ORDER BY {window.OrderBy} ROWS UNBOUNDED PRECEDING)",
                "change" => $"({value} - {previous})",
                // Ties share a rank, and the next rank skips as many (1, 2, 2, 4), as RANKX does.
                "rank" => $"RANK() OVER ({window.PartitionBy}ORDER BY {value} DESC)",
                "ytd" => $"SUM({value}) OVER ({YearPartition()}ORDER BY {window.OrderBy} ROWS UNBOUNDED PRECEDING)",
                "moving_avg" => $"AVG(1.0 * {value}) OVER ({window.PartitionBy}ORDER BY {window.OrderBy} ROWS BETWEEN {rows - 1} PRECEDING AND CURRENT ROW)",
                _ => $"(100.0 * ({value} - {previous}) / NULLIF(ABS({previous}), 0))",
            };
        }

        // YTD starts again each calendar year of the first field, which must hold dates. Without a field there is one
        // row, which it reads alone, as RUNNING_TOTAL does.
        string YearPartition()
        {
            if (window.First is null) return window.PartitionBy;
            if (window.First is not { Type: not null } first || !IsDate(first.Type))
                throw new QueryException(QueryErrors.InvalidMeasure,
                    $"{measure} uses YTD, which adds up along a date. Put a date field first on the visual, such as a day or a month.");
            var year = $"YEAR({window.OrderBy})";
            return window.PartitionBy.Length == 0 ? $"PARTITION BY {year} " : $"{window.PartitionBy.TrimEnd()}, {year} ";
        }

        // The column of a direct MIN/MAX operand, when its type is a date. Null for any other operand
        // (including a nested calculation, which is checked when it renders itself).
        Field? DateOperand(MeasureNode n)
        {
            if (n is not AggregateNode { Fn: not null, Arg: { Source: not null, Column: not null } } a) return null;
            if (a.Fn.ToLowerInvariant() is not ("min" or "max")) return null;
            var field = scope.Resolve(a.Arg.Source, a.Arg.Column);
            return field.Type is not null && IsDate(field.Type) ? field : null;
        }

        string Col(AggregateNode a) => Only(a, scope.Resolve(a.Arg.Source, a.Arg.Column).Sql);

        // An unknown type is not checked; SQL Server still refuses a real mismatch.
        string NumberCol(AggregateNode a, string label)
        {
            var field = scope.Resolve(a.Arg.Source, a.Arg.Column);
            if (field.Type is null || IsNumber(field.Type)) return Only(a, field.Sql);
            throw new QueryException(QueryErrors.InvalidMeasure,
                $"{label} needs a number column, but {field.Name} holds {Holds(field.Type)}.");
        }

        // CASE without ELSE gives NULL for the rows that fail the condition, and every aggregate skips NULL.
        string Only(AggregateNode a, string column)
            => a.Where is { } test ? $"CASE WHEN {Condition(a, test)} THEN {column} END" : column;

        string Condition(AggregateNode a, MeasureCondition test)
        {
            // Same source only: a column of another source would need a join the measure's rows do not
            // have, and would bypass the fan-trap check.
            if (!string.Equals(test.Column.Source, a.Arg.Source, StringComparison.OrdinalIgnoreCase))
                throw new QueryException(QueryErrors.InvalidMeasure,
                    $"The condition in {measure} must use a column of {a.Arg.Source}, the table it calculates over.");

            var field = scope.Resolve(test.Column.Source, test.Column.Column);
            var op = test.Op.ToLowerInvariant() switch
            {
                "eq" => "=",
                "neq" => "<>",
                "gt" => ">",
                "gte" => ">=",
                "lt" => "<",
                "lte" => "<=",
                _ => throw new QueryException(QueryErrors.InvalidMeasure, $"{measure} uses an unknown comparison \"{test.Op}\"."),
            };
            var value = TypedValue(field.Type, test.Value) ?? throw new QueryException(QueryErrors.InvalidMeasure,
                $"{measure} compares {field.Name}, which holds {Holds(field.Type!)}, with \"{test.Value}\". {UseInstead(field.Type!)}");
            return $"{field.Sql} {op} {param(value)}";
        }
    }

    /// <summary>
    /// One source as a CTE named by its alias. It selects from the table alone, so names are bare: each
    /// column the query reads, with its transforms applied, and each calculated column it reads.
    /// </summary>
    private static string RenderCte(ModelSource source, Scope scope, Func<object, string> param)
    {
        var columns = (scope.Used.GetValueOrDefault(source.Id) ?? []).Select(name =>
        {
            var sql = scope.CalculatedNamed(source, name) is { } calculated
                ? Expand(source, calculated, [], scope, param)
                : Transformed(source, name, scope, param);
            return sql == Quote(name) ? sql : $"{sql} AS {Quote(name)}";
        }).ToList();
        // COUNTROWS on its own reads no column, and a SELECT needs one.
        if (columns.Count == 0) columns.Add("1 AS [_row]");
        // A derived table needs an alias; a table keeps its bare name so existing queries are unchanged.
        var from = source.View is null ? Table(source, scope.Temps) : $"{Table(source, scope.Temps)} AS {Quote(source.Alias)}";
        // Removals read only this table's rows. The plant predicate stays in the outer WHERE.
        var removals = scope.Transforms[source.Id].Where(t => t.Kind == "remove_rows").Select(t => Removal(source, t, scope, param)).ToList();
        var where = removals.Count > 0 ? $" WHERE {string.Join(" AND ", removals)}" : "";
        return $"{Quote(source.Alias)} AS (SELECT {string.Join(", ", columns)} FROM {from}{where})";
    }

    /// <summary>A table column inside its source's CTE, with the source's transforms of it applied in order.</summary>
    private static string Transformed(ModelSource source, string column, Scope scope, Func<object, string> param)
        => TransformedUpTo(source, column, scope, param, null).Sql;

    /// <summary>
    /// A table column with its transforms applied in order, stopping before until when it is given, and the type it
    /// then holds. A removal of rows leaves the value as it is; RenderCte turns it into the CTE's WHERE.
    /// </summary>
    private static (string Sql, string? Type) TransformedUpTo(
        ModelSource source, string column, Scope scope, Func<object, string> param, ModelTransform? until)
    {
        var type = scope.CatalogType(source, column);
        var name = $"{source.Alias}.{column}";
        var sql = Quote(column);
        QueryException Unreadable() => new(QueryErrors.InvalidColumn, $"A transform of {name} cannot be read. Remove it and add it again.");

        foreach (var transform in scope.Transforms[source.Id].Where(t => string.Equals(t.Column, column, StringComparison.OrdinalIgnoreCase)))
        {
            if (ReferenceEquals(transform, until)) break;
            (sql, type) = transform.Kind switch
            {
                "trim" when type is null || IsText(type) => ($"LTRIM(RTRIM({sql}))", type),
                "trim" => throw new QueryException(QueryErrors.InvalidColumn, $"Trim works on text, but {name} holds {Holds(type!)}."),
                "null_fill" when transform.Value is not null => ($"COALESCE({sql}, {param(FillValue(transform.Value))})", type),
                "null_fill" => throw Unreadable(),
                "replace" => Replace(transform),
                "type" => Retype(transform),
                "remove_rows" => (sql, type),
                _ => throw new QueryException(QueryErrors.InvalidColumn,
                    $"{name} has a \"{transform.Kind}\" transform, which is not supported yet. Remove it."),
            };
        }
        return (sql, type);

        object FillValue(string value) => TypedValue(type, value) ?? throw new QueryException(QueryErrors.InvalidColumn,
            $"Blanks in {name} cannot be filled with \"{value}\" because it holds {Holds(type!)}. {UseInstead(type!)}");

        object Swapped(string value) => TypedValue(type, value) ?? throw new QueryException(QueryErrors.InvalidColumn,
            $"{name} holds {Holds(type!)}, so \"{value}\" cannot replace a value or be replaced. {UseInstead(type!)}");

        (string, string?) Replace(ModelTransform transform)
        {
            if (transform.Value is not { Length: > 0 } find || transform.Options?.GetValueOrDefault("with") is not { } replacement)
                throw Unreadable();
            // A whole value: only a cell equal to find changes, and both values are typed like a fill value.
            if (transform.Options?.GetValueOrDefault("match") == "whole")
                return ($"CASE WHEN {sql} = {param(Swapped(find))} THEN {param(Swapped(replacement))} ELSE {sql} END", type);
            if (type is not null && !IsText(type))
                throw new QueryException(QueryErrors.InvalidColumn,
                    $"Replacing part of a value works on text, but {name} holds {Holds(type)}. Replace whole values instead.");
            return ($"REPLACE({sql}, {param(find)}, {param(replacement)})", type);
        }

        // A value that cannot be read as the new type becomes blank; the transforms editor says so.
        (string, string?) Retype(ModelTransform transform)
        {
            switch (transform.Value)
            {
                case "number" when type is not null && IsNumber(type):
                case "date" when type is not null && IsDate(type):
                    return (sql, type);
                case "number" or "date" when type is not null && !IsText(type):
                    throw new QueryException(QueryErrors.InvalidColumn,
                        $"{name} holds {Holds(type)}, which cannot be changed to {(transform.Value == "number" ? "numbers" : "dates")}.");
                case "number":
                    return (ToNumberSql(sql), "decimal");
                case "date" when DateStyle(transform.Options?.GetValueOrDefault("style")) is { } style:
                    return ($"TRY_CONVERT(date, {sql}, {style})", "date");
                case "text":
                    // ISO text for dates, so they sort and read the same in every language. Style 3 writes every digit of a
                    // float, where the default would write 1234567 as 1.23457e+006.
                    var textStyle = type is null ? ""
                        : IsDate(type) ? (BaseType(type).Equals("date", StringComparison.OrdinalIgnoreCase) ? ", 23" : ", 126")
                        : BaseType(type).ToLowerInvariant() is "float" or "real" ? ", 3"
                        : "";
                    return ($"CONVERT(nvarchar(4000), {sql}{textStyle})", "nvarchar");
                default:
                    throw Unreadable();
            }
        }
    }

    /// <summary>
    /// A removal of rows as a test the CTE's rows must fail: the column as the transforms before the removal leave
    /// it, compared as the removal says. A blank cell fails every test but blank, so it stays.
    /// </summary>
    private static string Removal(ModelSource source, ModelTransform removal, Scope scope, Func<object, string> param)
    {
        var column = scope.Column(source, removal.Column).Column;
        var name = $"{source.Alias}.{column}";
        var (sql, type) = TransformedUpTo(source, column, scope, param, removal);
        var op = removal.Options?.GetValueOrDefault("op");
        QueryException Unreadable() => new(QueryErrors.InvalidColumn, $"A transform of {name} cannot be read. Remove it and add it again.");
        string Value() => removal.Value is null
            ? throw Unreadable()
            : param(TypedValue(type, removal.Value) ?? throw new QueryException(QueryErrors.InvalidColumn,
                $"Rows of {name} cannot be compared with \"{removal.Value}\" because it holds {Holds(type!)}. {UseInstead(type!)}"));

        var test = op switch
        {
            "eq" => $"{sql} = {Value()}",
            "neq" => $"{sql} <> {Value()}",
            "gt" => $"{sql} > {Value()}",
            "gte" => $"{sql} >= {Value()}",
            "lt" => $"{sql} < {Value()}",
            "lte" => $"{sql} <= {Value()}",
            "contains" or "starts_with" or "ends_with" when type is null || IsText(type)
                => $"{sql} LIKE {param(LikePattern(op, removal.Value is { Length: > 0 } find ? find : throw Unreadable()))} ESCAPE N'\\'",
            "contains" or "starts_with" or "ends_with" => throw new QueryException(QueryErrors.InvalidColumn,
                $"Removing rows by the text they hold works on text, but {name} holds {Holds(type!)}."),
            "blank" => BlankTest(sql, type),
            "not_blank" => $"NOT ({BlankTest(sql, type)})",
            _ => throw Unreadable(),
        };
        return $"CASE WHEN {test} THEN 1 ELSE 0 END = 0";
    }

    public static string? RetypedTo(string? target) => target switch
    {
        "number" => "decimal",
        "date" => "date",
        "text" => "nvarchar",
        _ => null,
    };

    /// <summary>
    /// A calculated column's formula inside its source's CTE. stack holds the calculated columns being
    /// expanded around it, outermost first, to refuse a circle and a chain deeper than MaxColumnDepth.
    /// </summary>
    private static string Expand(ModelSource source, ModelCalculatedColumn column, List<string> stack, Scope scope, Func<object, string> param)
    {
        var name = $"{source.Alias}.{column.Name}";
        if (stack.Contains(column.Name, StringComparer.OrdinalIgnoreCase))
            throw new QueryException(QueryErrors.InvalidColumn,
                $"Calculated columns cannot use each other in a circle: {string.Join(", ", stack.Append(column.Name).Select(n => $"{source.Alias}.{n}"))}.");
        if (stack.Count >= MaxColumnDepth)
            throw new QueryException(QueryErrors.InvalidColumn,
                $"{source.Alias}.{stack[0]} builds on calculated columns more than {MaxColumnDepth} levels deep. Write it in fewer steps.");
        if (column.Expression is null)
            throw new QueryException(QueryErrors.InvalidColumn, $"{name} is stored in a form that cannot be read. Edit it and save it again.");
        if (column.Expression is ColumnNode or NumberNode or TextNode)
            throw new QueryException(QueryErrors.InvalidColumn,
                $"{name} must calculate something, for example {source.Alias}.column * 60 or YEAR({source.Alias}.column).");

        stack.Add(column.Name);
        var sql = Bounded(RenderRow(column.Expression, source, name, stack, scope, param).Sql, name);
        stack.RemoveAt(stack.Count - 1);
        return sql;
    }

    // Checked at every node, so SQL that repeats its parts is refused before it can grow more than a few times past the limit.
    private static string Bounded(string sql, string owner) => sql.Length <= MaxRowSqlLength ? sql
        : throw new QueryException(QueryErrors.FormulaTooLarge,
            $"{owner} is too large to calculate. Use fewer functions inside each other, or fewer calculated columns built on each other.");

    /// <summary>One node of a calculated column's formula, as bare-named SQL inside the CTE, with its SQL Server type.</summary>
    private static (string Sql, string? Type) RenderRow(
        MeasureNode node, ModelSource source, string owner, List<string> stack, Scope scope, Func<object, string> param)
    {
        QueryException Refused(string message) => new(QueryErrors.InvalidColumn, message);

        switch (node)
        {
            case ColumnNode { Source: not null, Column: not null } c:
                if (!string.Equals(c.Source, source.Alias, StringComparison.OrdinalIgnoreCase))
                    throw Refused($"{owner} can only use columns of {source.Alias}.");
                var field = scope.Column(source, c.Column);
                return scope.CalculatedNamed(source, field.Column) is { } calculated
                    ? (Expand(source, calculated, stack, scope, param), field.Type)
                    : (Transformed(source, field.Column, scope, param), field.Type);
            case NumberNode n:
                return (NumberSql(n), "decimal");
            case TextNode { Value: not null } t:
                return (param(t.Value), "nvarchar");
            case BinaryNode { Op: "+" or "-" or "*" or "/", Left: not null, Right: not null } b:
                var left = Numeric(b.Left);
                var right = Numeric(b.Right);
                // The same rules as a measure: no integer division, no division by zero, a blank side of + or - counts as 0.
                return (b.Op switch
                {
                    "/" => $"(1.0 * {left} / NULLIF({right}, 0))",
                    "*" => $"({left} * {right})",
                    _ => $"({Blank(b.Left, left)} {b.Op} {Blank(b.Right, right)})",
                }, "decimal");
            // As a value a comparison is 1 when it holds and 0 when it does not, so it can be added up.
            case CompareNode { Op: not null, Left: not null, Right: not null } comparison:
                return ($"CASE WHEN {Compare(comparison)} THEN 1 ELSE 0 END", "int");
            case FunctionNode { Fn: not null, Args: not null } f when f.Args.All(arg => arg is not null):
                return Function(f);
            case AggregateNode a:
                throw Refused($"{owner} uses {a.Fn?.ToUpperInvariant()}, which adds up many rows. A calculated column works on one row at a time; build a measure instead.");
            default:
                throw Refused($"{owner} cannot be read. Edit it and save it again.");
        }

        (string Sql, string? Type) Inner(MeasureNode part)
        {
            var (sql, type) = RenderRow(part, source, owner, stack, scope, param);
            return (Bounded(sql, owner), type);
        }

        static string Blank(MeasureNode part, string sql) => part is NumberNode ? sql : $"COALESCE({sql}, 0)";

        static string What(MeasureNode part) => part switch
        {
            ColumnNode column => $"{column.Source}.{column.Column}",
            TextNode text => $"'{text.Value}'",
            NumberNode number => NumberSql(number),
            FunctionNode call => call.Fn?.ToUpperInvariant() ?? "a function",
            _ => "a calculation",
        };

        string Numeric(MeasureNode part)
        {
            var (sql, type) = Inner(part);
            return type is null || IsNumber(type) ? sql
                : throw Refused($"+, -, * and / in {owner} need numbers, but {What(part)} holds {Holds(type)}.");
        }

        // An unknown type is accepted, as for measures; SQL Server still refuses a real mismatch.
        string Typed(MeasureNode part, string label, Func<string, bool> fits, string needs)
        {
            var (sql, type) = Inner(part);
            return type is null || fits(type) ? sql
                : throw Refused($"{label} in {owner} needs {needs}, but {What(part)} holds {Holds(type)}.");
        }

        void Parts(FunctionNode call, int fewest, int most)
        {
            if (call.Args.Count < fewest || call.Args.Count > most)
                throw Refused($"{call.Fn.ToUpperInvariant()} in {owner} takes {(fewest == most ? $"{most}" : $"{fewest} to {most}")} part{(most == 1 ? "" : "s")}.");
        }

        // A whole number written in the formula, from low to high, as the part at index.
        string Whole(FunctionNode call, int index, int low, int high, string ordinal)
        {
            if (call.Args[index] is not NumberNode number || number.Value < low || number.Value > high || number.Value != decimal.Truncate(number.Value))
                throw Refused($"{call.Fn.ToUpperInvariant()} in {owner} needs a whole number from {low} to {high} as its {ordinal} part.");
            return number.Value.ToString("0", CultureInfo.InvariantCulture);
        }

        // Parts that can each be the result must hold the same kind of value: SQL Server would otherwise convert
        // text to numbers and fail at run time. The type is the first one known.
        string? OneKind(FunctionNode call, IReadOnlyList<MeasureNode> parts, IReadOnlyList<string?> types)
        {
            var known = parts.Zip(types).Where(p => p.Second is not null).ToList();
            if (known.FirstOrDefault(p => Holds(p.Second!) != Holds(known[0].Second!)) is { First: not null } other)
                throw Refused($"{call.Fn.ToUpperInvariant()} in {owner} mixes {What(known[0].First)}, which holds {Holds(known[0].Second!)}, " +
                    $"with {What(other.First)}, which holds {Holds(other.Second!)}.");
            return known.Count > 0 ? known[0].Second : null;
        }

        // A comparison as a predicate. Text written in the formula and compared with a number or a date is
        // converted as a measure condition's value is, and stays a parameter.
        string Compare(CompareNode comparison)
        {
            var op = comparison.Op.ToLowerInvariant() switch
            {
                "eq" => "=", "neq" => "<>", "gt" => ">", "gte" => ">=", "lt" => "<", "lte" => "<=",
                _ => throw Refused($"{owner} uses an unknown comparison \"{comparison.Op}\"."),
            };
            (string Sql, string? Type)? leftSide = comparison.Left is TextNode ? null : Inner(comparison.Left);
            (string Sql, string? Type)? rightSide = comparison.Right is TextNode ? null : Inner(comparison.Right);
            var (leftSql, leftType) = leftSide ?? Literal((TextNode)comparison.Left, rightSide?.Type, comparison.Right);
            var (rightSql, rightType) = rightSide ?? Literal((TextNode)comparison.Right, leftType, comparison.Left);
            if (leftType is not null && rightType is not null && Holds(leftType) != Holds(rightType))
                throw Refused($"{owner} compares {What(comparison.Left)}, which holds {Holds(leftType)}, " +
                    $"with {What(comparison.Right)}, which holds {Holds(rightType)}.");
            return $"{leftSql} {op} {rightSql}";
        }

        (string Sql, string? Type) Literal(TextNode text, string? otherType, MeasureNode other)
        {
            if (text.Value is null) throw Refused($"{owner} cannot be read. Edit it and save it again.");
            if (otherType is null || IsText(otherType)) return (param(text.Value), "nvarchar");
            var value = TypedValue(otherType, text.Value) ?? throw Refused(
                $"{owner} compares {What(other)}, which holds {Holds(otherType)}, with '{text.Value}'. {UseInstead(otherType)}");
            return (param(value), otherType);
        }

        // A condition as a predicate for CASE WHEN. Comparisons, AND, OR, NOT, ISBLANK and the text tests are
        // conditions; any other number counts as true when it is not 0, as in spreadsheets.
        string Condition(MeasureNode part, string label)
        {
            if (part is CompareNode { Op: not null, Left: not null, Right: not null } comparison) return Compare(comparison);
            if (part is FunctionNode { Fn: not null, Args: not null } call && call.Args.All(arg => arg is not null) && IsTest(call.Fn))
                return Test(call);
            var (sql, type) = Inner(part);
            return type is null || IsNumber(type) ? $"{sql} <> 0"
                : throw Refused($"{label} in {owner} needs a condition, such as {source.Alias}.column > 3, but {What(part)} holds {Holds(type)}.");
        }

        string Test(FunctionNode call)
        {
            var fn = call.Fn.ToLowerInvariant();
            var label = call.Fn.ToUpperInvariant();
            switch (fn)
            {
                case "and" or "or":
                    Parts(call, 2, 10);
                    return $"({string.Join(fn == "and" ? " AND " : " OR ", call.Args.Select(arg => Condition(arg, label)))})";
                case "not":
                    Parts(call, 1, 1);
                    // A blank value makes a condition unknown, and NOT unknown is unknown: it is read as false first.
                    return $"(CASE WHEN {Condition(call.Args[0], label)} THEN 1 ELSE 0 END = 0)";
                case "isblank":
                    Parts(call, 1, 1);
                    var (sql, type) = Inner(call.Args[0]);
                    return BlankTest(sql, type);
                default:
                    Parts(call, 2, 2);
                    if (call.Args[1] is not TextNode { Value: { Length: > 0 } find })
                        throw Refused($"{label} in {owner} needs text in single quotes as its second part, for example {label}({source.Alias}.column, 'A').");
                    return $"{Typed(call.Args[0], label, IsText, "text")} LIKE {param(LikePattern(fn, find))} ESCAPE N'\\'";
            }
        }

        // Piece n of text cut at separator, counting from 1, or the last piece for -1. Blank when the text has
        // fewer pieces; the whole text when it holds no separator and n is 1 or -1. STRING_SPLIT has no piece
        // number before SQL Server 2022, so this uses CHARINDEX. text is SQL; separator becomes a parameter.
        string Split(string text, string separator, int piece)
        {
            var sep = param(separator);
            if (piece == -1)
                return $"COALESCE(RIGHT({text}, NULLIF(CHARINDEX(REVERSE({sep}), REVERSE({text})), 0) - 1), {text})";
            // ponytail: each piece repeats the rest of the text twice, so pieces stop at 4 and Bounded caps the size. A split
            // transform that writes several columns is the upgrade if more are needed. nvarchar(max), so text already 4000
            // long keeps the separator added to it.
            var rest = $"(CAST({text} AS nvarchar(max)) + {sep})";
            for (var i = 1; i < piece; i++)
                rest = $"SUBSTRING({rest}, NULLIF(CHARINDEX({sep}, {rest}), 0) + {separator.Length}, {WholeRest})";
            return $"LEFT({rest}, NULLIF(CHARINDEX({sep}, {rest}), 0) - 1)";
        }

        (string Sql, string? Type) Function(FunctionNode call)
        {
            var label = call.Fn.ToUpperInvariant();
            string Text(MeasureNode part) => Typed(part, label, IsText, "text");
            string Date(MeasureNode part) => Typed(part, label, IsDate, "a date");
            string Number(MeasureNode part) => Typed(part, label, IsNumber, "numbers");

            switch (call.Fn.ToLowerInvariant())
            {
                case "concat":
                    Parts(call, 2, 10);
                    // SQL Server's CONCAT reads a blank part as empty text, as spreadsheet users expect.
                    return ($"CONCAT({string.Join(", ", call.Args.Select(arg => Typed(arg, label, type => !IsDate(type), "text or numbers")))})", "nvarchar");
                case "left" or "right":
                    Parts(call, 2, 2);
                    return ($"{label}({Text(call.Args[0])}, {Whole(call, 1, 1, 4000, "second")})", "nvarchar");
                case "upper" or "lower":
                    Parts(call, 1, 1);
                    return ($"{label}({Text(call.Args[0])})", "nvarchar");
                case "trim":
                    Parts(call, 1, 1);
                    // LTRIM(RTRIM()) rather than TRIM, which needs SQL Server 2017; the scripts support 2016.
                    return ($"LTRIM(RTRIM({Text(call.Args[0])}))", "nvarchar");
                case "year" or "month":
                    Parts(call, 1, 1);
                    return ($"{label}({Typed(call.Args[0], label, IsDate, "a date")})", "int");
                case "if":
                    Parts(call, 3, 3);
                    var condition = Condition(call.Args[0], label);
                    var branches = call.Args.Skip(1).Select(Inner).ToList();
                    return ($"CASE WHEN {condition} THEN {branches[0].Sql} ELSE {branches[1].Sql} END",
                        OneKind(call, call.Args.Skip(1).ToList(), branches.Select(branch => branch.Type).ToList()));
                case "coalesce" or "isnull" or "iferror":
                    if (call.Fn.Equals("coalesce", StringComparison.OrdinalIgnoreCase)) Parts(call, 2, 10);
                    else Parts(call, 2, 2);
                    // ISNULL and IFERROR are COALESCE too. SQL Server's own ISNULL would cut the fallback to the
                    // length of the first part, and a failed conversion or a division by zero is already blank here.
                    var values = call.Args.Select(Inner).ToList();
                    return ($"COALESCE({string.Join(", ", values.Select(v => v.Sql))})",
                        OneKind(call, call.Args, values.Select(v => v.Type).ToList()));
                case var test when IsTest(test):
                    return ($"CASE WHEN {Test(call)} THEN 1 ELSE 0 END", "int");
                case "len":
                    Parts(call, 1, 1);
                    // SQL Server's LEN does not count spaces at the end.
                    return ($"LEN({Typed(call.Args[0], label, type => !IsDate(type), "text or numbers")})", "int");
                case "replace":
                    Parts(call, 3, 3);
                    return ($"REPLACE({Text(call.Args[0])}, {Text(call.Args[1])}, {Text(call.Args[2])})", "nvarchar");
                case "substring":
                    Parts(call, 2, 3);
                    var value = Text(call.Args[0]);
                    return ($"SUBSTRING({value}, {Whole(call, 1, 1, 4000, "second")}, {(call.Args.Count == 3 ? Whole(call, 2, 1, 4000, "third") : WholeRest)})", "nvarchar");
                case "split":
                    Parts(call, 3, 3);
                    if (call.Args[1] is not TextNode { Value: { Length: > 0 and <= 100 } separator })
                        throw Refused($"SPLIT in {owner} needs the separator as text in single quotes, such as ' ', as its second part.");
                    if (call.Args[2] is not NumberNode { Value: -1m or 1m or 2m or 3m or 4m } piece)
                        throw Refused($"SPLIT in {owner} needs 1, 2, 3, 4 or -1 (the last piece) as its third part.");
                    return (Split(Text(call.Args[0]), separator, (int)piece.Value), "nvarchar");
                case "first_word" or "last_word":
                    Parts(call, 1, 1);
                    return (Split($"LTRIM(RTRIM({Text(call.Args[0])}))", " ",
                        call.Fn.Equals("first_word", StringComparison.OrdinalIgnoreCase) ? 1 : -1), "nvarchar");
                case "to_number":
                    Parts(call, 1, 1);
                    return (ToNumberSql(Text(call.Args[0])), "decimal");
                case "to_date":
                    Parts(call, 1, 2);
                    int? style = call.Args.Count == 1 ? 23 : call.Args[1] is TextNode { Value: var written } ? DateStyle(written) : null;
                    if (style is null) throw Refused($"TO_DATE in {owner} needs 'iso', 'dmy' or 'mdy' as its second part.");
                    return ($"TRY_CONVERT(date, {Text(call.Args[0])}, {style})", "date");
                case "day":
                    Parts(call, 1, 1);
                    return ($"DAY({Date(call.Args[0])})", "int");
                case "quarter":
                    Parts(call, 1, 1);
                    return ($"DATEPART(quarter, {Date(call.Args[0])})", "int");
                case "weekday":
                    Parts(call, 1, 1);
                    return (Weekday(Date(call.Args[0])), "int");
                case "month_name":
                    Parts(call, 1, 1);
                    // Names written here, not DATENAME, which follows the session language.
                    return ($"CHOOSE(MONTH({Date(call.Args[0])}), {Names(MonthNames)})", "nvarchar");
                case "weekday_name":
                    Parts(call, 1, 1);
                    return ($"CHOOSE({Weekday(Date(call.Args[0]))}, {Names(WeekdayNames)})", "nvarchar");
                case "month_start":
                    Parts(call, 1, 1);
                    var month = Date(call.Args[0]);
                    // DATETRUNC needs SQL Server 2022.
                    return ($"DATEFROMPARTS(YEAR({month}), MONTH({month}), 1)", "date");
                case "today":
                    Parts(call, 0, 0);
                    return ("CAST(GETDATE() AS date)", "date");
                case "datediff":
                    Parts(call, 2, 3);
                    var unit = call.Args.Count == 2 ? "days" : (call.Args[2] as TextNode)?.Value?.ToLowerInvariant();
                    if (unit is not ("days" or "hours" or "minutes" or "weeks" or "months" or "years"))
                        throw Refused($"DATEDIFF in {owner} needs 'days', 'hours', 'minutes', 'weeks', 'months' or 'years' as its third part.");
                    var later = Date(call.Args[0]);
                    var earlier = Date(call.Args[1]);
                    return (DateDiff(unit, later, earlier), unit == "weeks" ? "decimal" : "int");
                case "round":
                    Parts(call, 1, 2);
                    var rounded = Number(call.Args[0]);
                    return ($"ROUND({rounded}, {(call.Args.Count == 2 ? Whole(call, 1, -6, 6, "second") : "0")})", "decimal");
                case "abs" or "floor" or "ceiling":
                    Parts(call, 1, 1);
                    return ($"{label}({Number(call.Args[0])})", "decimal");
                case "min_of" or "max_of":
                    Parts(call, 2, 10);
                    var candidates = call.Args.Select(Inner).ToList();
                    var kind = OneKind(call, call.Args, candidates.Select(candidate => candidate.Type).ToList());
                    var pick = call.Fn.Equals("min_of", StringComparison.OrdinalIgnoreCase) ? "MIN" : "MAX";
                    // GREATEST and LEAST need SQL Server 2022. MIN and MAX over one row's values read no other row.
                    return ($"(SELECT {pick}(v) FROM (VALUES {string.Join(", ", candidates.Select(candidate => $"({candidate.Sql})"))}) AS m(v))", kind);
                case var across when IsWindow(across):
                    throw new QueryException(QueryErrors.CrossRowInColumn,
                        $"{owner} uses {label}, which compares a row with other rows. A calculated column works on one row at a time; use {label} in a measure instead.");
                default:
                    throw Refused($"{owner} uses an unknown function \"{call.Fn}\".");
            }
        }
    }

    // A SUBSTRING length that reaches the end of any text, nvarchar(max) included.
    private const string WholeRest = "2147483647";

    private static bool IsTest(string fn) => fn.ToLowerInvariant() is "and" or "or" or "not" or "isblank" or "contains" or "starts_with" or "ends_with";

    // Blank text is empty as well as missing, as in spreadsheets.
    private static string BlankTest(string sql, string? type)
        => type is not null && IsText(type) ? $"({sql} IS NULL OR {sql} = N'')" : $"{sql} IS NULL";

    // The value's own wildcards are escaped, so a % or _ in it matches only itself.
    private static string LikePattern(string test, string find)
    {
        var escaped = find.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_").Replace("[", @"\[");
        return test switch { "contains" => $"%{escaped}%", "starts_with" => $"{escaped}%", _ => $"%{escaped}" };
    }

    // Commas, currency and percent signs and spaces are removed first, so "$1,200" and "15 %" read as numbers.
    private static string ToNumberSql(string text)
        => $"TRY_CONVERT(decimal(38, 6), REPLACE(REPLACE(REPLACE(REPLACE({text}, N',', N''), N'$', N''), N'%', N''), N' ', N''))";

    // SQL Server date styles: 23 is yyyy-mm-dd, 103 is dd/mm/yyyy, 101 is mm/dd/yyyy.
    private static int? DateStyle(string? written) => written?.ToLowerInvariant() switch
    {
        null or "iso" => 23,
        "dmy" => 103,
        "mdy" => 101,
        _ => null,
    };

    private static readonly string[] MonthNames =
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    private static readonly string[] WeekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    private static string Names(IEnumerable<string> names) => string.Join(", ", names.Select(name => $"N'{name}'"));

    // 1 for Monday to 7 for Sunday, whatever SET DATEFIRST says.
    private static string Weekday(string date) => $"((DATEPART(weekday, {date}) + @@DATEFIRST - 2) % 7 + 1)";

    // later minus earlier, as DATEDIFF(later, earlier) reads in spreadsheets. Months and years count whole ones only,
    // like DATEDIF; SQL Server's DATEDIFF counts boundaries, so a correction takes off the part month or year.
    private static string DateDiff(string unit, string later, string earlier) => unit switch
    {
        "days" => $"DATEDIFF(day, {earlier}, {later})",
        "hours" => $"DATEDIFF(hour, {earlier}, {later})",
        "minutes" => $"DATEDIFF(minute, {earlier}, {later})",
        "weeks" => $"ROUND(DATEDIFF(day, {earlier}, {later}) / 7.0, 1)",
        "months" => $"(DATEDIFF(month, {earlier}, {later}) - CASE WHEN {later} >= {earlier} AND DAY({later}) < DAY({earlier}) THEN 1 " +
                    $"WHEN {later} < {earlier} AND DAY({later}) > DAY({earlier}) THEN -1 ELSE 0 END)",
        _ => $"(DATEDIFF(year, {earlier}, {later}) - CASE WHEN {later} >= {earlier} AND DATEADD(year, DATEDIFF(year, {earlier}, {later}), {earlier}) > {later} THEN 1 " +
             $"WHEN {later} < {earlier} AND DATEADD(year, DATEDIFF(year, {earlier}, {later}), {earlier}) < {later} THEN -1 ELSE 0 END)",
    };

    // Parenthesised when negative, so "x - -1" cannot put a "--" comment marker in the SQL.
    private static string NumberSql(NumberNode n)
        => n.Value.ToString(CultureInfo.InvariantCulture) is var text && text.StartsWith('-') ? $"({text})" : text;

    private static bool IsCountRows(AggregateNode a) => string.Equals(a.Fn, "count_rows", StringComparison.OrdinalIgnoreCase);

    private static bool IsWindow(string fn)
        => fn.ToLowerInvariant() is "percent_of_total" or "running_total" or "change" or "change_pct" or "rank" or "ytd" or "moving_avg";

    /// <summary>The first measure function in a measure's tree, or null when it has none.</summary>
    private static string? WindowIn(MeasureNode? node) => node switch
    {
        FunctionNode { Fn: not null } f when IsWindow(f.Fn) => f.Fn,
        FunctionNode f => (f.Args ?? []).Select(WindowIn).FirstOrDefault(fn => fn is not null),
        BinaryNode b => WindowIn(b.Left) ?? WindowIn(b.Right),
        _ => null,
    };

    /// <summary>
    /// The value typed for a column, so SQL Server never has to convert a text parameter at run time.
    /// Null when a number or date column is given a value that is not one.
    /// </summary>
    private static object? TypedValue(string? type, string value)
    {
        if (type is null) return value;
        if (IsNumber(type))
            return decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number)
                ? number
                : null;
        if (IsDate(type))
            return DateTime.TryParseExact(value, DateForms, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
        // ponytail: text, bit, time and other types go through as text; SQL Server converts them and
        // refuses a real mismatch at run time. Type them here when a user meets that error.
        return value;
    }

    private static string UseInstead(string type) => IsNumber(type) ? "Use a number." : "Use a date written as 2026-01-31.";

    // ISO forms only: no culture-dependent order such as 01/02/2026, and no time zone that would shift the value.
    private static readonly string[] DateForms =
        ["yyyy-MM-dd", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF"];

    private static readonly HashSet<string> NumberTypes = new(StringComparer.OrdinalIgnoreCase)
        { "int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money", "smallmoney" };

    private static readonly HashSet<string> DateTypes = new(StringComparer.OrdinalIgnoreCase)
        { "date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time" };

    // "decimal(18,2)" and "decimal" are the same type family.
    private static string BaseType(string type) => type.Split('(')[0].Trim();

    private static bool IsNumber(string type) => NumberTypes.Contains(BaseType(type));

    // time is left out: a DateTime parameter would add today's date to it.
    private static bool IsDate(string type)
        => BaseType(type).ToLowerInvariant() is "date" or "datetime" or "datetime2" or "smalldatetime" or "datetimeoffset";

    // What the text functions and trim accept: anything that is not a number, a date or time, or true/false.
    private static bool IsText(string type) => Holds(type) == "text";

    private static string Holds(string type)
        => IsNumber(type) ? "numbers"
        : DateTypes.Contains(BaseType(type)) ? "dates"
        : string.Equals(BaseType(type), "bit", StringComparison.OrdinalIgnoreCase) ? "true/false"
        : "text";

    private static string RenderFilter(Field field, QueryFilter filter, Func<object, string> param)
    {
        var values = filter.Values ?? [];
        var invalid = new QueryException(QueryErrors.InvalidFilter, $"The filter on {field.Name} is not complete.");
        string One() => values.Count == 1 ? param(values[0]) : throw invalid;

        return filter.Op.ToLowerInvariant() switch
        {
            "any" when filter.Any is { Count: > 0 and <= 10 } any && any.All(f => f.Any is null && string.Equals(f.Field, filter.Field, StringComparison.OrdinalIgnoreCase))
                => "(" + string.Join(" OR ", any.Select(f => RenderFilter(field, f, param))) + ")",
            "eq" => $"{field.Sql} = {One()}",
            "neq" => $"{field.Sql} <> {One()}",
            "gt" => $"{field.Sql} > {One()}",
            "gte" => $"{field.Sql} >= {One()}",
            "lt" => $"{field.Sql} < {One()}",
            "lte" => $"{field.Sql} <= {One()}",
            "in" when values.Count is > 0 and <= MaxInValues => $"{field.Sql} IN ({string.Join(", ", values.Select(v => param(v)))})",
            // A missing value is kept by "not in", as a spreadsheet filter that unticks some values keeps the blanks.
            "not_in" when values.Count is > 0 and <= MaxInValues
                => $"({field.Sql} IS NULL OR {field.Sql} NOT IN ({string.Join(", ", values.Select(v => param(v)))}))",
            "contains" or "starts_with" or "ends_with" when values.Count == 1
                => $"{field.Sql} LIKE {param(LikePattern(filter.Op.ToLowerInvariant(), Convert.ToString(values[0]) ?? ""))} ESCAPE N'\'",
            "not_contains" when values.Count == 1
                => $"({field.Sql} IS NULL OR {field.Sql} NOT LIKE {param(LikePattern("contains", Convert.ToString(values[0]) ?? ""))} ESCAPE N'\')",
            "between" when values.Count == 2 => $"{field.Sql} BETWEEN {param(values[0])} AND {param(values[1])}",
            "is_null" => $"{field.Sql} IS NULL",
            "not_null" => $"{field.Sql} IS NOT NULL",
            _ => throw invalid,
        };
    }

    /// <summary>
    /// A sum, count or average double-counts when a join fans out from the measure's source:
    /// walking the join tree away from that source, some step goes from the one side of a
    /// many_to_one relationship to its many side. A one_to_one relationship never fans out.
    /// </summary>
    private static void CheckFanTrap(
        ModelMeasure measure, AggregateNode aggregate, ModelSource source,
        IReadOnlyList<JoinStep> joins, IReadOnlyList<ModelSource> all)
    {
        if (FanSafeAggregates.Contains(aggregate.Fn)) return;

        var byId = all.ToDictionary(s => s.Id);
        var visited = new HashSet<long> { source.Id };
        var queue = new Queue<long>([source.Id]);
        while (queue.Count > 0)
        {
            var at = queue.Dequeue();
            foreach (var edge in joins.Select(j => j.Via))
            {
                long next;
                if (edge.FromSourceId == at) next = edge.ToSourceId;
                else if (edge.ToSourceId == at) next = edge.FromSourceId;
                else continue;
                if (!visited.Add(next)) continue;

                // Fail safe: anything not exactly one_to_one is treated as many_to_one.
                var oneToOne = string.Equals(edge.Cardinality?.Trim(), "one_to_one", StringComparison.OrdinalIgnoreCase);
                if (!oneToOne && edge.ToSourceId == at)
                    throw new QueryException(QueryErrors.FanTrap,
                        $"{measure.Name} would count each {byId[at].Alias} row once per matching {byId[next].Alias} row. " +
                        $"Remove the {byId[next].Alias} fields from this query, or use a measure based on {byId[next].Alias}.");
                queue.Enqueue(next);
            }
        }
    }

    private static string? RlsPredicate(ModelSource source, UserScope user, Scope scope, Func<object, string> param)
    {
        if (string.Equals(source.RlsMode, "none", StringComparison.OrdinalIgnoreCase)) return null;

        if (!string.Equals(source.RlsMode, "plant", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(source.RlsPlantColumn))
            throw new QueryException(QueryErrors.RlsUnconfigured,
                $"{source.Alias} has no row-level security setting. An administrator must set one before it can be queried.");

        // The plant filter compares the stored plant code: nothing may change the column it reads.
        if (scope.Transforms[source.Id].Any(t => string.Equals(t.Column, source.RlsPlantColumn, StringComparison.OrdinalIgnoreCase))
            || scope.CalculatedNamed(source, source.RlsPlantColumn) is not null)
            throw new QueryException(QueryErrors.RlsUnconfigured,
                $"{source.Alias}.{source.RlsPlantColumn} decides who sees which rows, so a transform or a calculated column cannot change it. Remove the transform.");

        // Checked for every user, so a missing plant column is found by administrators too.
        scope.Column(source, source.RlsPlantColumn);
        if (user.IsAdmin) return null;

        // Fail closed: a user with no plant assignment sees nothing from plant-scoped sources.
        if (user.PlantCodes is not { Count: > 0 } plants) return "1 = 0";

        var column = scope.Resolve(source.Alias, source.RlsPlantColumn);
        return $"{column.Sql} IN ({string.Join(", ", plants.Select(c => param(c)))})";
    }

    private static string From(ModelSource s, Scope scope) => scope.HasCte(s) ? Quote(s.Alias) : $"{Table(s, scope.Temps)} AS {Quote(s.Alias)}";

    /// <summary>temps names the temporary table of each script source the query reads.</summary>
    private static string Table(ModelSource s, IReadOnlyDictionary<long, string> temps)
        => s.View is { } view ? $"({view.Sql})"
            : s.Script is not null ? temps[s.Id]
            : TableName(s.Database, s.SchemaName, s.SourceName);

    /// <summary>A table's quoted name: schema.table, or database.schema.table for a table of another database.</summary>
    public static string TableName(string? database, string schema, string table)
        => (database is null ? "" : $"{Quote(database)}.") + $"{Quote(schema)}.{Quote(table)}";

    private static string Quote(string identifier) => "[" + identifier.Replace("]", "]]") + "]";
}
