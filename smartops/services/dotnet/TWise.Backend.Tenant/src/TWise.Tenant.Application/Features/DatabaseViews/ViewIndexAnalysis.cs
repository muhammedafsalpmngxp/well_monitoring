using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace TWise.Tenant.Application.Features.DatabaseViews;

/// <summary>A real table the view reads and the columns it filters, joins and sorts on.</summary>
public sealed class ViewTableUsage(string? database, string? schema, string table)
{
    public string? Database { get; } = database;
    public string? Schema { get; } = schema;
    public string Table { get; } = table;
    /// <summary>Compared with a value: col = x, col IN (...).</summary>
    public List<string> EqualityColumns { get; } = [];
    /// <summary>Compared with a range: &lt;, &gt;, BETWEEN, LIKE.</summary>
    public List<string> RangeColumns { get; } = [];
    /// <summary>Compared with another table's column in a join or filter.</summary>
    public List<string> JoinColumns { get; } = [];
    /// <summary>GROUP BY / ORDER BY columns.</summary>
    public List<string> SortColumns { get; } = [];

    public string DisplayName => string.Join('.', new[] { Database, Schema, Table }.Where(p => !string.IsNullOrEmpty(p)));

    internal static void AddOnce(List<string> list, string column)
    {
        if (!list.Contains(column, StringComparer.OrdinalIgnoreCase)) list.Add(column);
    }
}

/// <summary>
/// Reads a view's T-SQL (never runs it) and lists the real tables it reads with the columns used in
/// filters, joins and sorting — the columns an index can serve. CTEs, temp tables and table
/// variables are left out. Columns wrapped in functions (LTRIM(col) = x) are not index-usable and
/// are skipped.
/// </summary>
public static class ViewIndexAnalysis
{
    /// <summary>Null when the SQL does not parse.</summary>
    public static IReadOnlyList<ViewTableUsage>? Analyze(string? sql)
    {
        if (string.IsNullOrWhiteSpace(sql)) return [];
        var script = new TSql160Parser(initialQuotedIdentifiers: true).Parse(new StringReader(sql), out var errors);
        if (errors.Count > 0) return null;

        var ctes = new CteCollector();
        script.Accept(ctes);
        var collector = new QueryCollector(ctes.Names);
        script.Accept(collector);
        return collector.Tables.Values.ToList();
    }

    private sealed class CteCollector : TSqlFragmentVisitor
    {
        public HashSet<string> Names { get; } = new(StringComparer.OrdinalIgnoreCase);
        public override void Visit(CommonTableExpression node) => Names.Add(node.ExpressionName.Value);
    }

    /// <summary>Visits every SELECT block (outer query, CTE bodies, subqueries) on its own.</summary>
    private sealed class QueryCollector(HashSet<string> cteNames) : TSqlFragmentVisitor
    {
        public Dictionary<string, ViewTableUsage> Tables { get; } = new(StringComparer.OrdinalIgnoreCase);

        public override void Visit(QuerySpecification node)
        {
            var sources = new FromWalker();
            node.FromClause?.Accept(sources);

            // Alias (or table name) → table usage, for this SELECT block only.
            var scope = new Dictionary<string, ViewTableUsage>(StringComparer.OrdinalIgnoreCase);
            foreach (var reference in sources.Tables)
            {
                var name = reference.SchemaObject;
                var table = name.BaseIdentifier.Value;
                if (table.StartsWith('#') || (name.SchemaIdentifier is null && cteNames.Contains(table))) continue;
                var usage = Usage(name.DatabaseIdentifier?.Value, name.SchemaIdentifier?.Value, table);
                scope[reference.Alias?.Value ?? table] = usage;
                scope.TryAdd(table, usage);
            }
            if (scope.Count == 0) return;

            var single = scope.Values.Distinct().Count() == 1 ? scope.Values.First() : null;
            var predicates = new PredicateWalker(scope, single);
            foreach (var condition in sources.JoinConditions) condition.Accept(predicates);
            node.WhereClause?.SearchCondition?.Accept(predicates);

            foreach (var item in node.GroupByClause?.GroupingSpecifications.OfType<ExpressionGroupingSpecification>() ?? [])
                if (Resolve(item.Expression, scope, single) is { } column) ViewTableUsage.AddOnce(column.Usage.SortColumns, column.Name);
            foreach (var item in node.OrderByClause?.OrderByElements ?? [])
                if (Resolve(item.Expression, scope, single) is { } column) ViewTableUsage.AddOnce(column.Usage.SortColumns, column.Name);
        }

        private ViewTableUsage Usage(string? database, string? schema, string table)
        {
            var key = $"{database}.{schema ?? "dbo"}.{table}";
            if (!Tables.TryGetValue(key, out var usage)) Tables[key] = usage = new ViewTableUsage(database, schema, table);
            return usage;
        }
    }

    /// <summary>Tables and join conditions of one FROM clause; derived tables are their own SELECT blocks.</summary>
    private sealed class FromWalker : TSqlFragmentVisitor
    {
        public List<NamedTableReference> Tables { get; } = [];
        public List<BooleanExpression> JoinConditions { get; } = [];
        public override void Visit(NamedTableReference node) => Tables.Add(node);
        public override void Visit(QualifiedJoin node) => JoinConditions.Add(node.SearchCondition);
        public override void ExplicitVisit(QueryDerivedTable node) { }
        public override void ExplicitVisit(ScalarSubquery node) { }
    }

    private sealed class PredicateWalker(Dictionary<string, ViewTableUsage> scope, ViewTableUsage? single) : TSqlFragmentVisitor
    {
        public override void Visit(BooleanComparisonExpression node)
        {
            var left = Resolve(node.FirstExpression, scope, single);
            var right = Resolve(node.SecondExpression, scope, single);
            if (left is not null && right is not null)
            {
                ViewTableUsage.AddOnce(left.Usage.JoinColumns, left.Name);
                ViewTableUsage.AddOnce(right.Usage.JoinColumns, right.Name);
                return;
            }
            var column = left ?? right;
            if (column is null) return;
            switch (node.ComparisonType)
            {
                case BooleanComparisonType.Equals:
                    ViewTableUsage.AddOnce(column.Usage.EqualityColumns, column.Name);
                    break;
                case BooleanComparisonType.GreaterThan or BooleanComparisonType.GreaterThanOrEqualTo
                    or BooleanComparisonType.LessThan or BooleanComparisonType.LessThanOrEqualTo:
                    ViewTableUsage.AddOnce(column.Usage.RangeColumns, column.Name);
                    break;
            }
        }

        public override void Visit(InPredicate node)
        {
            if (!node.NotDefined && Resolve(node.Expression, scope, single) is { } column)
                ViewTableUsage.AddOnce(column.Usage.EqualityColumns, column.Name);
        }

        public override void Visit(BooleanTernaryExpression node)
        {
            if (node.TernaryExpressionType == BooleanTernaryExpressionType.Between
                && Resolve(node.FirstExpression, scope, single) is { } column)
                ViewTableUsage.AddOnce(column.Usage.RangeColumns, column.Name);
        }

        public override void Visit(LikePredicate node)
        {
            // LIKE 'abc%' can seek an index; LIKE '%abc' cannot.
            var leadingWildcard = node.SecondExpression is StringLiteral { Value: var pattern } && pattern.StartsWith('%');
            if (!node.NotDefined && !leadingWildcard && Resolve(node.FirstExpression, scope, single) is { } column)
                ViewTableUsage.AddOnce(column.Usage.RangeColumns, column.Name);
        }

        // Subqueries are their own SELECT blocks with their own aliases.
        public override void ExplicitVisit(ScalarSubquery node) { }
        public override void ExplicitVisit(QueryDerivedTable node) { }
        public override void ExplicitVisit(ExistsPredicate node) { }
    }

    private sealed record ResolvedColumn(ViewTableUsage Usage, string Name);

    /// <summary>A bare column reference (alias.col, table.col, or col when the block reads one table).</summary>
    private static ResolvedColumn? Resolve(ScalarExpression? expression, Dictionary<string, ViewTableUsage> scope, ViewTableUsage? single)
    {
        while (expression is ParenthesisExpression parenthesis) expression = parenthesis.Expression;
        if (expression is not ColumnReferenceExpression { ColumnType: ColumnType.Regular, MultiPartIdentifier: { } parts }) return null;
        var ids = parts.Identifiers;
        var column = ids[^1].Value;
        if (ids.Count == 1) return single is null ? null : new(single, column);
        return scope.TryGetValue(ids[^2].Value, out var usage) ? new(usage, column) : null;
    }
}
