using System.Globalization;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using TWise.Tenant.Application.Features.DatabaseViews;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>One output column of a view, with its type as sys.dm_exec_describe_first_result_set names it.</summary>
public sealed record ViewColumn(string Name, string DataType);

/// <summary>
/// A View Builder view as a dataset sees it. Sql is null, and Problems says why, when the view cannot be a
/// source. Columns is what SQL Server described for the checked SQL; empty when it could not. Text is the SQL as saved.
/// Script is set for a view that cannot be a view source: how it would run as written instead (ScriptSource).
/// </summary>
public sealed record PreparedView(
    long Id, string Name, string? Description, CheckedViewSql? Sql, IReadOnlyList<string> Problems, IReadOnlyList<ViewColumn> Columns)
{
    public bool IsUsable => Sql is not null && Problems.Count == 0 && Columns.Count > 0;

    public string? Text { get; init; }

    public ScriptView? Script { get; init; }
}

/// <summary>
/// Turns the stored SQL of a View Builder view into text the query compiler may place in a query as a
/// derived table. Pure, so every rule is pinned by a unit test.
/// </summary>
public static class ViewSource
{
    /// <summary>SchemaName of a view source. Its SourceName is the view's id.</summary>
    public const string Schema = "view";

    public static string Key(long viewId) => viewId.ToString(CultureInfo.InvariantCulture);

    private static readonly HashSet<string> SystemSchemas = new(StringComparer.OrdinalIgnoreCase) { "sys", "INFORMATION_SCHEMA" };

    /// <summary>
    /// The view's SQL checked against the view contract and the embedding checks, and printed again from its
    /// parse tree; or null with the reasons, written for the person who has to fix the view. isTable says
    /// whether a schema and name is a table in the catalogue of the view's connection; the view may read nothing else.
    /// </summary>
    public static (CheckedViewSql? Sql, IReadOnlyList<string> Problems) Prepare(string? sql, string? description, Func<string, string, bool> isTable)
    {
        var contract = ViewContract.Check(sql, description);
        if (contract.Count > 0)
            return (null, contract.Select(v => $"Rule {v.Rule}: {v.Message}").ToList());

        // The contract passed, so the SQL parses to exactly one SELECT, bare or inside CREATE VIEW.
        var script = (TSqlScript)new TSql160Parser(initialQuotedIdentifiers: true).Parse(new StringReader(sql!), out _);
        var statement = script.Batches.SelectMany(b => b.Statements).Single();
        var select = statement as SelectStatement ?? ((ViewStatementBody)statement).SelectStatement;

        var finder = new EmbeddingFinder();
        select.Accept(finder);
        var problems = new List<string>();
        if (select.WithCtesAndXmlNamespaces is not null)
            problems.Add("It starts with WITH, which a data model cannot use yet. Move each WITH part into a subquery in FROM.");
        if (select.OptimizerHints.Count > 0)
            problems.Add("It ends with OPTION (...). Remove the query hints.");
        if (finder.ForClause)
            problems.Add("It uses FOR XML or FOR JSON. Return plain rows instead.");
        if (finder.Rowsets.Count > 0)
            problems.Add($"It reads data outside this connection's database with {string.Join(", ", finder.Rowsets.Order())}.");
        // A one-part name could bind to a CTE of the compiled query instead of the table the author meant.
        // A view with WITH is refused above, and its own CTE names are one-part.
        if (select.WithCtesAndXmlNamespaces is null && finder.Unqualified.Count > 0)
            problems.Add($"It reads {string.Join(", ", finder.Unqualified.Order())} without a schema. Name the schema of every table, for example dbo.{finder.Unqualified.Order().First()}.");
        if (finder.System.Count > 0)
            problems.Add($"It reads {string.Join(", ", finder.System.Order())} from a system schema. A view may read only tables of this connection's database.");
        if (finder.Functions.Count > 0)
            problems.Add($"It reads rows from the function {string.Join(", ", finder.Functions.Order())}. A view may read only tables.");
        var unknown = finder.Qualified.Where(t => !isTable(t.Schema, t.Table)).Select(t => $"{t.Schema}.{t.Table}").Distinct(StringComparer.OrdinalIgnoreCase).Order().ToList();
        if (unknown.Count > 0)
            problems.Add($"It reads {string.Join(", ", unknown)}, which is not a table of this connection. Sync the connection's schema, or read a table it lists.");
        if (problems.Count > 0) return (null, problems);

        var query = select.QueryExpression;
        // An ORDER BY means nothing in a view, and SQL Server refuses it in a subquery without TOP or OFFSET.
        if (query.OrderByClause is not null && query.OffsetClause is null && query is not QuerySpecification { TopRowFilter: not null })
            query.OrderByClause = null;

        // Printed from the tree: comments, batch separators and a trailing semicolon cannot survive.
        // A fresh statement, because the generator prints ORDER BY only as part of a statement.
        new Sql160ScriptGenerator().GenerateScript(new SelectStatement { QueryExpression = query }, out var text);
        return (new CheckedViewSql(text.Trim()), []);
    }

    /// <summary>Why SQL Server's description of a view cannot serve as a source's columns; empty when it can.</summary>
    public static IReadOnlyList<string> ColumnProblems(IReadOnlyList<ViewColumn> columns)
    {
        if (columns.Count == 0)
            return ["SQL Server could not read the columns of this view. Open it in View Builder and run its preview."];

        var problems = new List<string>();
        if (columns.Any(c => string.IsNullOrWhiteSpace(c.Name)))
            problems.Add("An output column has no name. Give every column a name.");
        var repeated = columns.Where(c => !string.IsNullOrWhiteSpace(c.Name))
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();
        if (repeated.Count > 0)
            problems.Add($"More than one output column is called {string.Join(", ", repeated)}. Give each column its own name.");
        return problems;
    }

    /// <summary>Catalogue entries of a usable view, keyed ("view", "&lt;id&gt;", column); none for any other view.</summary>
    public static IEnumerable<CatalogColumn> CatalogColumns(PreparedView view)
        => view.IsUsable
            ? view.Columns.Select(c => new CatalogColumn(Schema, Key(view.Id), c.Name, false, false, null, null, null, c.DataType))
            : [];

    /// <summary>
    /// The SQL stored on a view source when a modeller added or last updated it, for a query. Only
    /// DatasetRules stores it, from Prepare. A source stored before the SQL was kept is refused.
    /// </summary>
    public static CheckedViewSql Stored(string alias, string? viewSql)
        => string.IsNullOrWhiteSpace(viewSql)
            ? throw new QueryException(QueryErrors.ViewSourceNeedsUpdate,
                $"{alias} was added from a view before its SQL was kept with the data model. Ask a modeller to update {alias} from its view in Model Studio.")
            : new CheckedViewSql(viewSql);

    /// <summary>
    /// The checked SQL of a view as it is now, for a preview. A view deleted or broken since it was
    /// listed fails closed with a typed refusal.
    /// </summary>
    public static CheckedViewSql Require(string alias, string sourceName, IReadOnlyList<PreparedView> views)
    {
        var view = views.FirstOrDefault(v => Key(v.Id) == sourceName)
            ?? throw new QueryException(QueryErrors.SourceNotContractCompliant,
                $"The view behind {alias} no longer exists. Remove {alias} from the data model.");
        return view.IsUsable
            ? view.Sql!
            : throw new QueryException(QueryErrors.SourceNotContractCompliant,
                $"The view behind {alias} can no longer be used. {view.Problems.FirstOrDefault()} Fix it in View Builder.");
    }

    /// <summary>The schema-qualified tables stored view SQL reads; none when it does not parse.</summary>
    public static IReadOnlyList<(string Schema, string Table)> Tables(string viewSql)
    {
        if (new TSql160Parser(initialQuotedIdentifiers: true).Parse(new StringReader(viewSql), out var errors) is not { } tree || errors.Count > 0)
            return [];
        var finder = new EmbeddingFinder();
        tree.Accept(finder);
        return finder.Qualified;
    }

    /// <summary>The ids of the views behind a dataset's view and script sources.</summary>
    public static IReadOnlyList<long> Ids(IEnumerable<DatasetSource> sources) => sources
        .Where(s => s.SourceKind is "view" or ScriptSource.Kind)
        .Select(s => long.TryParse(s.SourceName, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : 0)
        .Where(id => id > 0)
        .Distinct()
        .ToList();

    private sealed class EmbeddingFinder : TSqlFragmentVisitor
    {
        public bool ForClause { get; private set; }
        public HashSet<string> Rowsets { get; } = [];
        public HashSet<string> Unqualified { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> System { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> Functions { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<(string Schema, string Table)> Qualified { get; } = [];

        public override void Visit(QueryExpression node)
        {
            if (node.ForClause is not null) ForClause = true;
        }

        public override void Visit(NamedTableReference node)
        {
            var name = node.SchemaObject;
            if (name.SchemaIdentifier is null) Unqualified.Add(name.BaseIdentifier.Value);
            else if (SystemSchemas.Contains(name.SchemaIdentifier.Value)) System.Add($"{name.SchemaIdentifier.Value}.{name.BaseIdentifier.Value}");
            else Qualified.Add((name.SchemaIdentifier.Value, name.BaseIdentifier.Value));
        }

        public override void Visit(SchemaObjectFunctionTableReference node) => Functions.Add(Name(node.SchemaObject));
        public override void Visit(GlobalFunctionTableReference node) => Functions.Add(node.Name.Value.ToUpperInvariant());
        public override void Visit(BuiltInFunctionTableReference node) => Functions.Add(node.Name.Value);
        public override void Visit(OpenJsonTableReference node) => Functions.Add("OPENJSON");
        public override void Visit(OpenXmlTableReference node) => Functions.Add("OPENXML");
        public override void Visit(FullTextTableReference node) => Functions.Add(node.FullTextFunctionType.ToString().ToUpperInvariant());
        public override void Visit(SemanticTableReference node) => Functions.Add(node.SemanticFunctionType.ToString().ToUpperInvariant());
        public override void Visit(ChangeTableChangesTableReference node) => Functions.Add("CHANGETABLE");
        public override void Visit(ChangeTableVersionTableReference node) => Functions.Add("CHANGETABLE");

        private static string Name(SchemaObjectName name)
            => string.Join(".", name.Identifiers.Select(i => i.Value));

        public override void Visit(OpenRowsetTableReference node) => Rowsets.Add("OPENROWSET");
        public override void Visit(BulkOpenRowset node) => Rowsets.Add("OPENROWSET");
        public override void Visit(OpenQueryTableReference node) => Rowsets.Add("OPENQUERY");
        public override void Visit(AdHocTableReference node) => Rowsets.Add("OPENDATASOURCE");
    }
}
