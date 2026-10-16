using System.Globalization;
using System.Text.Json;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>
/// A variable a saved view declares, with its type and initial value as written ("NULL" when none; null for a caller who
/// may not read the view's SQL), and the model field bound to it. Bindable is false when the batch sets it again after
/// declaring it, so a bound value would be overwritten.
/// </summary>
public sealed record ScriptParameter(string Name, string Type, string? Default, string? Field = null, bool Bindable = true);

/// <summary>
/// A view that fails the view contract, as it would run as written: its batch as saved, why it cannot (empty when
/// it can), and the columns SQL Server described for the batch.
/// </summary>
public sealed record ScriptView(string Text, IReadOnlyList<string> Problems, IReadOnlyList<ViewColumn> Columns)
{
    public bool IsUsable => Problems.Count == 0 && Columns.Count > 0;
}

/// <summary>
/// A View Builder view used exactly as saved (SourceKind script): DECLAREs, SET NOCOUNT, variable assignments and
/// one final SELECT, which may start with WITH and end with ORDER BY. A query runs the batch into a temporary table,
/// #s0, with the row's place in the view's order as row_order, and reads the source from there. Pure, so every rule
/// is pinned by a unit test.
/// </summary>
public static class ScriptSource
{
    public const string Kind = "script";

    /// <summary>SchemaName of a script source. Its SourceName is the view's id, as for a view source.</summary>
    public const string Schema = "script";

    /// <summary>The synthetic column that holds each row's place in the view's own ORDER BY, from 1.</summary>
    public const string RowOrder = "row_order";

    private static TSql160Parser Parser() => new(initialQuotedIdentifiers: true);

    private static readonly HashSet<string> SystemSchemas = new(StringComparer.OrdinalIgnoreCase) { "sys", "INFORMATION_SCHEMA", "master", "msdb" };

    /// <summary>Built-in functions that return rows and read nothing but their arguments.</summary>
    private static readonly HashSet<string> PureRowFunctions = new(StringComparer.OrdinalIgnoreCase) { "STRING_SPLIT", "GENERATE_SERIES" };

    /// <summary>
    /// Why the batch cannot run as written, for the person who has to fix the view; empty when it can. database is
    /// the connection's database, which a three-part name may name; any other database or a server is refused.
    /// isTable says whether a schema and name is a table in the catalogue of the connection, as for a view source
    /// (ViewSource.Prepare): the batch may read those, its own WITH parts, STRING_SPLIT and GENERATE_SERIES, and the
    /// table-valued functions of the database's own schemas. System schemas are refused.
    /// </summary>
    public static IReadOnlyList<string> Check(string? sql, string? database, Func<string, string, bool> isTable)
    {
        if (string.IsNullOrWhiteSpace(sql)) return ["The view has no SQL."];
        var tree = (TSqlScript)Parser().Parse(new StringReader(sql), out var errors);
        if (errors.Count > 0) return [$"The SQL does not parse: line {errors[0].Line}: {errors[0].Message}"];
        if (tree.Batches.Count > 1) return ["It is split into batches with GO. Keep one batch."];

        var statements = tree.Batches.SelectMany(b => b.Statements).ToList();
        var problems = new List<string>();
        if (statements is not [.., SelectStatement final] || AssignsOnly(final))
            problems.Add("It must end with one final SELECT that returns rows.");
        else if (final.Into is not null)
            problems.Add("It writes its rows into a table with SELECT INTO. Return the rows instead.");
        foreach (var statement in (statements is [.., SelectStatement] ? statements.SkipLast(1) : statements).Where(s => !Allowed(s)))
            problems.Add($"It runs {FirstWord(statement)}. A saved view may hold only DECLARE, SET and SELECT @variable = ... before its final SELECT.");

        var finder = new Finder(database, isTable);
        tree.Accept(finder);
        problems.AddRange(finder.Problems);
        // A one-part name may be a WITH part of the batch; any other needs its schema, as for a view source.
        problems.AddRange(finder.Unqualified.Where(name => !finder.Ctes.Contains(name))
            .Select(name => $"It reads {name} without a schema. Name the schema of every table, for example dbo.{name}."));
        return problems.Distinct().ToList();
    }

    /// <summary>Why SQL Server's description of the batch cannot serve as a source's columns; empty when it can.</summary>
    public static IReadOnlyList<string> ColumnProblems(IReadOnlyList<ViewColumn> columns)
        => columns.Any(c => string.Equals(c.Name, RowOrder, StringComparison.OrdinalIgnoreCase))
            ? [$"It returns a column called {RowOrder}, a name the data model keeps for the row's place in the view's order. Rename that column."]
            : ViewSource.ColumnProblems(columns);

    /// <summary>Catalogue entries of a script source keyed ("script", "&lt;id&gt;", column): row_order first, then the view's columns.</summary>
    public static IEnumerable<CatalogColumn> CatalogColumns(string sourceName, IReadOnlyList<ViewColumn> columns)
        => columns.Prepend(new ViewColumn(RowOrder, "int"))
            .Select(c => new CatalogColumn(Schema, sourceName, c.Name, false, false, null, null, null, c.DataType));

    /// <summary>The variables the batch declares, in order, with the field each is bound to in paramsJson; none when it does not parse.</summary>
    public static IReadOnlyList<ScriptParameter> Parameters(string? sql, string? paramsJson)
    {
        if (Statements(sql) is not { } statements) return [];
        var bindings = Bindings(paramsJson);
        var assigned = new Assignments();
        foreach (var statement in statements) statement.Accept(assigned);
        return statements.OfType<DeclareVariableStatement>().SelectMany(d => d.Declarations)
            .Select(e => new ScriptParameter(e.VariableName.Value, Text(sql!, e.DataType).ToLowerInvariant(),
                e.Value is null ? "NULL" : Text(sql!, e.Value), bindings.GetValueOrDefault(e.VariableName.Value),
                !assigned.Names.Contains(e.VariableName.Value)))
            .ToList();
    }

    /// <summary>The stored bindings, variable to "alias.column"; none when there are none or the JSON cannot be read.</summary>
    public static IReadOnlyDictionary<string, string> Bindings(string? json)
    {
        var bindings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json)) return bindings;
        try
        {
            foreach (var (name, field) in JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? []) bindings[name] = field;
        }
        catch (JsonException)
        {
        }
        return bindings;
    }

    /// <summary>
    /// A binding to one end of a range, "alias.column:from" or "alias.column:to": a between filter on the field sets
    /// the variable to its first or last value, gte or gt to its only value for from, lte or lt for to. So one date
    /// range slicer sets a view's @start_date and @end_date.
    /// </summary>
    public const string FromEnd = ":from";
    public const string ToEnd = ":to";

    /// <summary>The field of a binding and the end of a range it takes; null for a binding to the field's one value.</summary>
    public static (string Field, string? End) RangeEnd(string binding)
    {
        foreach (var end in new[] { FromEnd, ToEnd })
            if (binding.EndsWith(end, StringComparison.OrdinalIgnoreCase)) return (binding[..^end.Length], end);
        return (binding, null);
    }

    /// <summary>The value a filter gives a variable bound to its field, or to one end of a range on it; null when it gives none.</summary>
    private static string? ValueFor(string? end, QueryFilter filter, string view) => (end, filter.Op?.ToLowerInvariant(), filter.Values) switch
    {
        (null, "in" or "eq", _) => filter.Values is [{ } one] ? one
            : throw new QueryException(QueryErrors.InvalidFilter, $"Choose one value for {filter.Field}; the view {view} takes one."),
        (FromEnd, "between", [{ } from, _]) => from,
        (ToEnd, "between", [_, { } to]) => to,
        (FromEnd, "gte" or "gt", [{ } from]) => from,
        (ToEnd, "lte" or "lt", [{ } to]) => to,
        _ => null,
    };

    /// <summary>
    /// Takes out of the filters each one that sets a variable of a script source the query reads: in or eq on the
    /// field the variable is bound to, or a range on it for a variable bound to one end (RangeEnd). Values holds, per
    /// source id, each variable's value. A bound field with more or fewer than one value is refused, since the variable
    /// holds one value. The filter stays when the query also reads
    /// the bound field's table, so that table's rows are filtered too. When the query reads only script sources, a
    /// filter on a table it does not read and no variable takes is skipped, as the dashboard skips a filter a view has
    /// no variable for; Skipped names those fields, so the caller can say the rows are not filtered by them.
    /// </summary>
    public static (IReadOnlyList<QueryFilter> Filters, Dictionary<long, Dictionary<string, string>> Values, IReadOnlyList<string> Skipped) TakeBound(
        IEnumerable<ModelSource> read, IReadOnlyList<QueryFilter> filters)
    {
        var reading = read.Distinct().ToList();
        var onlyScripts = reading.Count > 0 && reading.All(s => s.Script is not null);
        var scripts = reading.Where(s => s.Script is { Bindings.Count: > 0 }).ToList();
        var values = new Dictionary<long, Dictionary<string, string>>();
        var rest = new List<QueryFilter>();
        var skipped = new List<string>();
        foreach (var filter in filters)
        {
            // The compiler refuses a malformed filter with a plain message.
            if (filter is null)
            {
                rest.Add(filter!);
                continue;
            }
            var readsTable = reading.Any(s => filter.Field?.StartsWith(s.Alias + ".", StringComparison.OrdinalIgnoreCase) == true);
            var takers = filter.Field is null ? [] : scripts.SelectMany(s => s.Script!.Bindings
                    .Select(b => (Source: s, Variable: b.Key, Bound: RangeEnd(b.Value)))
                    .Where(b => string.Equals(b.Bound.Field, filter.Field, StringComparison.OrdinalIgnoreCase)))
                .Select(b => (b.Source, b.Variable, Value: ValueFor(b.Bound.End, filter, b.Source.Script!.Name)))
                .Where(b => b.Value is not null).ToList();
            if (takers.Count == 0)
            {
                if (onlyScripts && filter.Field is not null && !readsTable && !Takes(reading, filter)) skipped.Add(filter.Field);
                else rest.Add(filter);
                continue;
            }
            foreach (var (source, variable, value) in takers)
            {
                if (!values.TryGetValue(source.Id, out var own)) values[source.Id] = own = new(StringComparer.OrdinalIgnoreCase);
                own[variable] = value!;
            }
            if (readsTable) rest.Add(filter);
        }
        return (rest, values, skipped.Distinct(StringComparer.OrdinalIgnoreCase).ToList());
    }

    private static bool Takes(IEnumerable<ModelSource> sources, QueryFilter filter)
        => sources.Any(s => s.Script?.Bindings.Values.Any(field => string.Equals(RangeEnd(field).Field, filter.Field, StringComparison.OrdinalIgnoreCase)) == true);

    /// <summary>
    /// The statements that fill temp with the rows of the script source: the view's statements with each variable
    /// renamed for temp (@plant becomes @s0_plant, so two views and the query's own parameters never clash) and a bound
    /// variable's initial value replaced by a parameter, then CREATE TABLE temp with row_order and the described
    /// columns, then the view's final statement as INSERT INTO temp ... SELECT, which numbers the rows in its ORDER BY.
    /// </summary>
    public static string Prelude(ModelSource source, string temp, IReadOnlyDictionary<string, string>? values, Func<object, string> param)
    {
        var script = source.Script!;
        if (Statements(script.Batch) is not [.., SelectStatement final] statements)
            throw new QueryException(QueryErrors.ViewSourceNeedsUpdate,
                $"The SQL kept for {source.Alias} can no longer be read. Remove {source.Alias} and add its view again.");
        // Checked again before every run, besides when the source was added (DatasetRules.NewScriptSource).
        // ponytail: the catalogue of tables is not known here, so only the rules that need none are checked again.
        if (Check(script.Batch, script.Database, (_, _) => true).FirstOrDefault() is { } refused)
            throw new QueryException(QueryErrors.SourceNotContractCompliant,
                $"{source.Alias} cannot run as written. {refused} Fix the view, then update {source.Alias} from it.");
        if (ColumnProblems(script.Columns).FirstOrDefault() is { } unreadable)
            throw new QueryException(QueryErrors.SourceNotContractCompliant, $"{source.Alias} cannot be read. {unreadable}");

        var prefix = $"@{temp.TrimStart('#')}_";
        foreach (var statement in statements) statement.Accept(new Renamer(prefix));
        foreach (var element in statements.OfType<DeclareVariableStatement>().SelectMany(d => d.Declarations))
            if (values?.GetValueOrDefault("@" + element.VariableName.Value[prefix.Length..]) is { } value)
                element.Value = new VariableReference { Name = param(value) };

        var insert = new InsertStatement
        {
            WithCtesAndXmlNamespaces = final.WithCtesAndXmlNamespaces,
            InsertSpecification = new InsertSpecification
            {
                Target = new NamedTableReference { SchemaObject = new SchemaObjectName { Identifiers = { new Identifier { Value = temp } } } },
                InsertOption = InsertOption.Into,
                InsertSource = new SelectInsertSource { Select = final.QueryExpression },
            },
        };
        foreach (var column in script.Columns)
            insert.InsertSpecification.Columns.Add(new ColumnReferenceExpression
            {
                MultiPartIdentifier = new MultiPartIdentifier { Identifiers = { new Identifier { Value = column.Name, QuoteType = QuoteType.SquareBracket } } },
            });
        foreach (var hint in final.OptimizerHints) insert.OptimizerHints.Add(hint);

        // Text columns take the database's collation, not tempdb's, so they compare with its tables as the view's did.
        // A rowversion cannot be inserted, so its eight bytes are kept as binary(8).
        var columns = script.Columns.Select(c => $"{Quote(c.Name)} {(c.DataType.ToLowerInvariant() is "timestamp" or "rowversion" ? "binary(8)" : c.DataType)}"
            + (c.DataType.Contains("char", StringComparison.OrdinalIgnoreCase) || c.DataType.Contains("text", StringComparison.OrdinalIgnoreCase) ? " COLLATE DATABASE_DEFAULT" : ""));
        return string.Join("\n", statements.SkipLast(1).Select(Print)
            .Append($"CREATE TABLE {temp} ({Quote(RowOrder)} int IDENTITY(1,1), {string.Join(", ", columns)});")
            .Append(Print(insert)));
    }

    /// <summary>The statements of a batch that parses as one batch; null when it does not.</summary>
    private static IReadOnlyList<TSqlStatement>? Statements(string? sql)
    {
        if (string.IsNullOrWhiteSpace(sql)) return null;
        var tree = (TSqlScript)Parser().Parse(new StringReader(sql), out var errors);
        return errors.Count > 0 || tree.Batches.Count != 1 ? null : tree.Batches[0].Statements.ToList();
    }

    private static bool Allowed(TSqlStatement statement) => statement switch
    {
        DeclareVariableStatement => true,
        PredicateSetStatement set => set.Options == SetOptions.NoCount,
        SetVariableStatement set => set.CursorDefinition is null,
        SelectStatement select => select.Into is null && AssignsOnly(select),
        _ => false,
    };

    /// <summary>True for SELECT @a = ..., which sets variables and returns no rows.</summary>
    private static bool AssignsOnly(SelectStatement select)
        => select.QueryExpression is QuerySpecification { SelectElements: var elements } && elements.All(e => e is SelectSetVariable);

    private static string FirstWord(TSqlFragment fragment) => fragment.ScriptTokenStream[fragment.FirstTokenIndex].Text.ToUpperInvariant();

    /// <summary>The fragment as written in sql.</summary>
    private static string Text(string sql, TSqlFragment fragment) => sql.Substring(fragment.StartOffset, fragment.FragmentLength);

    /// <summary>One statement printed from its tree, without comments, ending with a semicolon so a WITH after it reads right.</summary>
    private static string Print(TSqlStatement statement)
    {
        new Sql160ScriptGenerator().GenerateScript(statement, out var text);
        return text.Trim().TrimEnd(';') + ";";
    }

    private static string Quote(string identifier) => "[" + identifier.Replace("]", "]]") + "]";

    private sealed class Renamer(string prefix) : TSqlFragmentVisitor
    {
        public override void Visit(VariableReference node) => node.Name = prefix + node.Name.TrimStart('@');

        public override void Visit(DeclareVariableElement node) => node.VariableName.Value = prefix + node.VariableName.Value.TrimStart('@');
    }

    /// <summary>The variables a SET or SELECT @v = ... assigns.</summary>
    private sealed class Assignments : TSqlFragmentVisitor
    {
        public HashSet<string> Names { get; } = new(StringComparer.OrdinalIgnoreCase);

        public override void Visit(SetVariableStatement node) => Names.Add(node.Variable.Name);
        public override void Visit(SelectSetVariable node) => Names.Add(node.Variable.Name);
    }

    private sealed class Finder(string? database, Func<string, string, bool> isTable) : TSqlFragmentVisitor
    {
        public List<string> Problems { get; } = [];
        public List<string> Unqualified { get; } = [];
        public HashSet<string> Ctes { get; } = new(StringComparer.OrdinalIgnoreCase);

        private bool OtherDatabase(Identifier? db) => db is not null && !string.Equals(db.Value, database, StringComparison.OrdinalIgnoreCase);

        public override void Visit(SchemaObjectName node)
        {
            var name = string.Join(".", node.Identifiers.Select(i => i.Value));
            if (node.ServerIdentifier is not null)
                Problems.Add($"It reads {name} through another server. A saved view may read only this connection's database.");
            else if (OtherDatabase(node.DatabaseIdentifier))
                Problems.Add($"It reads {name} from another database. A saved view may read only this connection's database.");
            else if (node.BaseIdentifier?.Value.StartsWith('#') == true)
                Problems.Add($"It uses the temporary table {name}. Use a WITH part instead.");
            else if (node.SchemaIdentifier is { } schema && SystemSchemas.Contains(schema.Value))
                Problems.Add($"It reads {schema.Value}.{node.BaseIdentifier!.Value} from a system schema. A saved view may read only tables of this connection's database.");
        }

        public override void Visit(CommonTableExpression node) => Ctes.Add(node.ExpressionName.Value);

        public override void Visit(NamedTableReference node)
        {
            var name = node.SchemaObject;
            foreach (var hint in node.TableHints.Where(h => h.HintKind is not (TableHintKind.NoLock or TableHintKind.ReadUncommitted or TableHintKind.Index)))
                Problems.Add($"It uses the table hint {hint.HintKind.ToString().ToUpperInvariant()}. A saved view may use only NOLOCK, READUNCOMMITTED and INDEX(...).");
            // Other servers, other databases, temporary tables and system schemas are reported by Visit(SchemaObjectName).
            if (name.ServerIdentifier is not null || OtherDatabase(name.DatabaseIdentifier) || name.BaseIdentifier.Value.StartsWith('#')) return;
            if (name.SchemaIdentifier is null) Unqualified.Add(name.BaseIdentifier.Value);
            else if (!SystemSchemas.Contains(name.SchemaIdentifier.Value) && !isTable(name.SchemaIdentifier.Value, name.BaseIdentifier.Value))
                Problems.Add($"It reads {name.SchemaIdentifier.Value}.{name.BaseIdentifier.Value}, which is not a table of this connection. Sync the connection's schema, or read a table it lists.");
        }

        public override void Visit(SchemaObjectFunctionTableReference node)
        {
            if (node.SchemaObject.SchemaIdentifier is null)
                Problems.Add($"It reads rows from the function {node.SchemaObject.BaseIdentifier.Value} without a schema. Name its schema, for example dbo.{node.SchemaObject.BaseIdentifier.Value}.");
        }

        public override void Visit(GlobalFunctionTableReference node)
        {
            if (!PureRowFunctions.Contains(node.Name.Value)) Function(node.Name.Value.ToUpperInvariant());
        }

        public override void Visit(BuiltInFunctionTableReference node) => Function(node.Name.Value);
        public override void Visit(OpenJsonTableReference node) => Function("OPENJSON");
        public override void Visit(OpenXmlTableReference node) => Function("OPENXML");
        public override void Visit(FullTextTableReference node) => Function(node.FullTextFunctionType.ToString().ToUpperInvariant());
        public override void Visit(SemanticTableReference node) => Function(node.SemanticFunctionType.ToString().ToUpperInvariant());
        public override void Visit(ChangeTableChangesTableReference node) => Function("CHANGETABLE");
        public override void Visit(ChangeTableVersionTableReference node) => Function("CHANGETABLE");

        // ponytail: a column's method call (t.shape.STArea()) reads like db.schema.fn() and is refused as another database
        // unless t is the database's name; allow methods here if a view needs them.
        public override void Visit(FunctionCall node)
        {
            if (node.CallTarget is not MultiPartIdentifierCallTarget { MultiPartIdentifier.Identifiers: var parts }) return;
            var name = string.Join(".", parts.Select(p => p.Value).Append(node.FunctionName.Value));
            if (parts.Count >= 2 && OtherDatabase(parts[0]))
                Problems.Add($"It calls {name} from another database. A saved view may read only this connection's database.");
            else if (SystemSchemas.Contains(parts[^1].Value))
                Problems.Add($"It calls {name} from a system schema. A saved view may read only tables of this connection's database.");
        }

        public override void Visit(NextValueForExpression node)
            => Problems.Add("It uses NEXT VALUE FOR, which moves a sequence on every run. Read the numbers from a table instead.");

        public override void Visit(OpenRowsetTableReference node) => Rowset("OPENROWSET");
        public override void Visit(BulkOpenRowset node) => Rowset("OPENROWSET");
        public override void Visit(OpenQueryTableReference node) => Rowset("OPENQUERY");
        public override void Visit(AdHocTableReference node) => Rowset("OPENDATASOURCE");

        private void Rowset(string function) => Problems.Add($"It reads data outside this connection's database with {function}.");

        private void Function(string function)
            => Problems.Add($"It reads rows from the function {function}. A saved view may read tables, STRING_SPLIT and the database's own functions.");
    }
}
