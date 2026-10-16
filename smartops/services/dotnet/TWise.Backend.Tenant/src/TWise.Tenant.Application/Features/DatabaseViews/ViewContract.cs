using Microsoft.SqlServer.TransactSql.ScriptDom;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

/// <summary>
/// Checks a view against docs/VIEW-CONTRACT.md. A compliant view is one the model layer can
/// push filters and the row-level security predicate into. The result is advisory: a view
/// that fails still saves and still runs on the existing chart and report path.
/// Rule 5 (no pre-aggregation unless the grain says so) is not checked mechanically; the
/// declared grain in rule 4 is how the author states it.
/// </summary>
public static class ViewContract
{
    // Reading today (GETDATE, CURRENT_TIMESTAMP and the like) is allowed: a model query whose SQL reads the clock is
    // never answered from the result cache (RunModelQueryHandler.ReadsClock). Random values are refused.
    private static readonly HashSet<string> NonDeterministicFunctions = new(StringComparer.OrdinalIgnoreCase)
    {
        "NEWID", "NEWSEQUENTIALID", "RAND", "CRYPT_GEN_RANDOM"
    };

    public static IReadOnlyList<ViewContractViolation> Check(string? sql, string? description)
    {
        var violations = new List<ViewContractViolation>();

        if (description is null || !description.Contains("one row per", StringComparison.OrdinalIgnoreCase))
            violations.Add(new(4, "The description does not state the grain. Add a sentence such as \"One row per well per day\"."));

        if (string.IsNullOrWhiteSpace(sql))
        {
            violations.Add(new(1, "The view has no SQL."));
            return violations;
        }

        var script = new TSql160Parser(initialQuotedIdentifiers: true)
            .Parse(new StringReader(sql), out var errors) as TSqlScript;
        if (errors.Count > 0 || script is null)
        {
            violations.Add(new(1, $"The SQL could not be read as T-SQL: {errors.FirstOrDefault()?.Message ?? "unknown error"}."));
            return violations;
        }

        var statements = script.Batches.SelectMany(b => b.Statements).ToList();
        var select = statements.Count == 1
            ? statements[0] switch
            {
                SelectStatement s => s,
                ViewStatementBody v => v.SelectStatement,
                _ => null
            }
            : null;

        if (select is null)
        {
            violations.Add(new(1, statements.Count == 1
                ? "The view must be a single SELECT statement."
                : $"The view contains {statements.Count} statements. It must be a single SELECT, with no DECLARE, SET, IF or temp tables."));
            return violations;
        }

        if (select.Into is not null)
            violations.Add(new(1, "SELECT ... INTO is not allowed. The view must only return rows."));

        var walker = new Walker();
        select.Accept(walker);

        if (walker.UsesVariables)
            violations.Add(new(1, "The view uses variables or parameters. Expose the underlying column instead and let the platform filter on it."));
        if (walker.UsesTempTables)
            violations.Add(new(1, "The view reads a temp table. Temp tables are not allowed."));
        if (walker.UsesSelectStar)
            violations.Add(new(2, "SELECT * is not allowed. Name every output column."));
        if (walker.CrossDatabaseNames.Count > 0)
            violations.Add(new(3, $"The view reads another database ({string.Join(", ", walker.CrossDatabaseNames.Order())}). Only tables in the tenant database are allowed."));
        if (walker.NonDeterministicCalls.Count > 0)
            violations.Add(new(7, $"The view calls {string.Join(", ", walker.NonDeterministicCalls.Order())}, which gives a different value on every run. Remove it."));

        foreach (var spec in OuterSpecifications(select.QueryExpression))
        {
            var unnamed = spec.SelectElements.OfType<SelectScalarExpression>()
                .Count(e => e.ColumnName is null && e.Expression is not ColumnReferenceExpression);
            if (unnamed > 0)
                violations.Add(new(2, $"{unnamed} output column(s) have no alias. Give every calculated column a name."));

            if (spec.SelectElements.OfType<SelectScalarExpression>().Any(e => ContainsWindowFunction(e.Expression)))
                violations.Add(new(6, "Window functions in the final SELECT block filter pushdown. Move them into the source or drop them."));
        }

        foreach (var cte in select.WithCtesAndXmlNamespaces?.CommonTableExpressions ?? [])
        {
            var name = cte.ExpressionName.Value;
            if (References(cte.QueryExpression, name) > 0)
                violations.Add(new(6, $"CTE {name} is recursive. Recursive CTEs are not allowed."));
            else if (References(select, name) > 1)
                violations.Add(new(6, $"CTE {name} is referenced more than once. Each CTE may be used only once."));
        }

        return violations
            .DistinctBy(v => v.Message)
            .OrderBy(v => v.Rule)
            .ToList();
    }

    // For UNION and similar, every branch contributes to the final projection.
    private static IEnumerable<QuerySpecification> OuterSpecifications(QueryExpression? expression) => expression switch
    {
        QuerySpecification spec => [spec],
        BinaryQueryExpression binary => OuterSpecifications(binary.FirstQueryExpression).Concat(OuterSpecifications(binary.SecondQueryExpression)),
        QueryParenthesisExpression paren => OuterSpecifications(paren.QueryExpression),
        _ => []
    };

    private static bool ContainsWindowFunction(TSqlFragment fragment)
    {
        var finder = new WindowFinder();
        fragment.Accept(finder);
        return finder.Found;
    }

    private static int References(TSqlFragment fragment, string cteName)
    {
        var counter = new TableReferenceCounter(cteName);
        fragment.Accept(counter);
        return counter.Count;
    }

    private sealed class Walker : TSqlFragmentVisitor
    {
        public bool UsesVariables { get; private set; }
        public bool UsesTempTables { get; private set; }
        public bool UsesSelectStar { get; private set; }
        public HashSet<string> CrossDatabaseNames { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> NonDeterministicCalls { get; } = new(StringComparer.OrdinalIgnoreCase);

        public override void Visit(VariableReference node) => UsesVariables = true;
        public override void Visit(SelectStarExpression node) => UsesSelectStar = true;

        public override void Visit(SchemaObjectName node)
        {
            if (node.BaseIdentifier?.Value.StartsWith('#') == true)
                UsesTempTables = true;
            if (node.DatabaseIdentifier is not null)
                CrossDatabaseNames.Add(node.DatabaseIdentifier.Value);
        }

        public override void Visit(FunctionCall node)
        {
            if (NonDeterministicFunctions.Contains(node.FunctionName.Value))
                NonDeterministicCalls.Add(node.FunctionName.Value.ToUpperInvariant() + "()");
        }
    }

    private sealed class WindowFinder : TSqlFragmentVisitor
    {
        public bool Found { get; private set; }
        public override void Visit(OverClause node) => Found = true;
    }

    private sealed class TableReferenceCounter(string name) : TSqlFragmentVisitor
    {
        public int Count { get; private set; }

        public override void Visit(NamedTableReference node)
        {
            var obj = node.SchemaObject;
            if (obj.SchemaIdentifier is null && string.Equals(obj.BaseIdentifier.Value, name, StringComparison.OrdinalIgnoreCase))
                Count++;
        }
    }
}
