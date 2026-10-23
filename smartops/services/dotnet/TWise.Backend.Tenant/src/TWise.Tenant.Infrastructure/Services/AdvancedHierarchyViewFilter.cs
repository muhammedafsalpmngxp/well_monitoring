using System.Text.RegularExpressions;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

internal static class AdvancedHierarchyViewFilter
{
    private static readonly IReadOnlyDictionary<string, string[]> Columns = new Dictionary<string, string[]>
    {
        ["ceo-sector-head"] = ["ceo", "sectorhead", "ceosectorhead", "chiefexecutiveofficer"],
        ["bu-head"] = ["buhead", "businessunithead", "executivevicepresident", "evp"],
        ["division-head"] = ["divisionhead", "projectdirector", "projectdirectorname"],
        ["cluster-heads"] = ["clusterheads", "clusterhead", "clustermanager"],
        ["plant-project-head"] = ["plantprojecthead", "planthead", "projecthead", "sitemanager", "sitemanagera", "sitemanagerb"],
        ["nationality"] = ["nationality"],
        ["resource-type"] = ["resource", "resourcetype", "atnmsc"],
        ["position-category"] = ["positioncategory"],
        ["subcontractor-company"] = ["subcontractorcompany", "subcontractorcompanyid", "companyid"],
    };

    public static ViewFilterResult Apply(string sql, IReadOnlyList<ChartFilterParam> filters, int baseParamIndex)
    {
        var parameters = new List<ViewFilterParamValue>();
        var currentSql = sql;
        foreach (var filter in filters)
        {
            if (!Columns.TryGetValue(filter.AdvancedHierarchy!, out var aliases))
                throw new InvalidOperationException($"Unknown advanced hierarchy field: {filter.AdvancedHierarchy}");

            var script = Parse(currentSql);
            var queries = new QueryVisitor(aliases);
            script.Accept(queries);
            if (filter.AdvancedHierarchy == "resource-type")
            {
                var resourceParameter = new ResourceParameterVisitor();
                script.Accept(resourceParameter);
                if (resourceParameter.Found && !queries.Matches.Any(match =>
                    match.Scope.Placeholders.Contains("resource", StringComparer.OrdinalIgnoreCase)))
                {
                    var result = ViewFilterHelper.ApplyViewFilters(currentSql,
                        [filter with { AdvancedHierarchy = null, Label = "resource", SourceColumn = "resource", SourceTable = "resource" }],
                        baseParamIndex + parameters.Count);
                    if (result.IsEmptyResult || result.Parameters.Count == 0)
                        throw new InvalidOperationException("Cannot apply advanced Resource Type to view parameter resource.");
                    currentSql = result.Sql;
                    parameters.AddRange(result.Parameters);
                    continue;
                }
            }
            if (queries.Matches.Count == 0) continue;

            // Keep an existing scalar/default parameter from contradicting the advanced selection.
            var placeholders = queries.Matches.SelectMany(match => match.Scope.Placeholders)
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            foreach (var placeholder in placeholders)
            {
                var result = ViewFilterHelper.ApplyViewFilters(currentSql,
                    [filter with { AdvancedHierarchy = null, Label = placeholder, SourceColumn = placeholder, SourceTable = placeholder }],
                    baseParamIndex + parameters.Count);
                if (result.IsEmptyResult)
                    throw new InvalidOperationException($"Cannot apply advanced hierarchy to view parameter {placeholder}.");
                currentSql = result.Sql;
                parameters.AddRange(result.Parameters);
            }

            script = Parse(currentSql);
            queries = new QueryVisitor(aliases);
            script.Accept(queries);
            var values = ViewFilterHelper.GetEffectiveValues(filter);
            var names = values.Select((_, index) => $"@p{baseParamIndex + parameters.Count + index}").ToList();
            parameters.AddRange(values.Select((value, index) => new ViewFilterParamValue(names[index], value)));
            List<string>? employeeResourceNames = null;

            foreach (var (query, scope) in queries.Matches)
            {
                BooleanExpression? predicate = null;
                foreach (var column in scope.Columns.DistinctBy(column =>
                    string.Join(".", column.MultiPartIdentifier.Identifiers.Select(identifier => identifier.Value)),
                    StringComparer.OrdinalIgnoreCase))
                {
                    var membership = new InPredicate { Expression = column };
                    var columnNames = names;
                    if (filter.AdvancedHierarchy == "resource-type"
                        && Normalize(column.MultiPartIdentifier.Identifiers.Last().Value) == "atnmsc")
                    {
                        if (employeeResourceNames is null)
                        {
                            employeeResourceNames = [];
                            foreach (var value in values)
                            {
                                var name = $"@p{baseParamIndex + parameters.Count}";
                                var storedValue = value.Equals("SubContractor", StringComparison.OrdinalIgnoreCase) ? "SC" : value;
                                employeeResourceNames.Add(name);
                                parameters.Add(new ViewFilterParamValue(name, storedValue));
                            }
                        }
                        columnNames = employeeResourceNames;
                    }
                    foreach (var name in columnNames) membership.Values.Add(new VariableReference { Name = name });
                    predicate = predicate is null ? membership : new BooleanBinaryExpression
                    {
                        BinaryExpressionType = BooleanBinaryExpressionType.Or,
                        FirstExpression = predicate,
                        SecondExpression = membership,
                    };
                }

                var advancedCondition = new BooleanParenthesisExpression { Expression = predicate! };
                query.WhereClause = new WhereClause
                {
                    SearchCondition = query.WhereClause is null ? advancedCondition : new BooleanBinaryExpression
                    {
                        BinaryExpressionType = BooleanBinaryExpressionType.And,
                        FirstExpression = new BooleanParenthesisExpression { Expression = query.WhereClause.SearchCondition },
                        SecondExpression = advancedCondition,
                    },
                };
            }
            new Sql160ScriptGenerator().GenerateScript(script, out currentSql);
        }
        return new ViewFilterResult(currentSql, parameters, IsEmptyResult: false);
    }

    private static TSqlFragment Parse(string sql)
    {
        var parser = new TSql160Parser(initialQuotedIdentifiers: true);
        using var reader = new StringReader(sql);
        var fragment = parser.Parse(reader, out var errors);
        if (errors.Count > 0)
            throw new InvalidOperationException($"Cannot apply advanced hierarchy to invalid view SQL: {errors[0].Message}");
        return fragment;
    }

    private static string Normalize(string column) => Regex.Replace(column, "[^a-zA-Z0-9]", "").ToLowerInvariant();

    private sealed class ResourceParameterVisitor : TSqlFragmentVisitor
    {
        public bool Found { get; private set; }

        public override void Visit(DeclareVariableElement node)
        {
            if (node.VariableName.Value.Equals("@resource", StringComparison.OrdinalIgnoreCase))
                Found = true;
        }
    }

    private sealed class QueryVisitor(string[] aliases) : TSqlFragmentVisitor
    {
        public List<(QuerySpecification Query, ScopeVisitor Scope)> Matches { get; } = [];

        public override void Visit(QuerySpecification query)
        {
            var scope = new ScopeVisitor(aliases);
            foreach (var element in query.SelectElements) element.Accept(scope);
            query.FromClause?.Accept(scope);
            query.WhereClause?.Accept(scope);
            query.GroupByClause?.Accept(scope);
            query.HavingClause?.Accept(scope);
            if (scope.Columns.Count > 0) Matches.Add((query, scope));
        }
    }

    private sealed class ScopeVisitor(string[] aliases) : TSqlFragmentVisitor
    {
        public List<ColumnReferenceExpression> Columns { get; } = [];
        public List<string> Placeholders { get; } = [];

        public override void ExplicitVisit(QuerySpecification node) { }
        public override void ExplicitVisit(ScalarSubquery node) { }

        public override void Visit(ColumnReferenceExpression node)
        {
            if (Matches(node)) Columns.Add(node);
        }

        public override void Visit(BooleanComparisonExpression node)
        {
            if (node.ComparisonType != BooleanComparisonType.Equals) return;
            if (node.FirstExpression is ColumnReferenceExpression column && Matches(column)
                && node.SecondExpression is VariableReference variable)
                Placeholders.Add(variable.Name.TrimStart('@'));
            if (node.SecondExpression is ColumnReferenceExpression otherColumn && Matches(otherColumn)
                && node.FirstExpression is VariableReference otherVariable)
                Placeholders.Add(otherVariable.Name.TrimStart('@'));
        }

        public override void Visit(InPredicate node)
        {
            if (node.Expression is not ColumnReferenceExpression column || !Matches(column) || node.NotDefined)
                return;
            foreach (var variable in node.Values.OfType<VariableReference>())
                Placeholders.Add(variable.Name.TrimStart('@'));
            if (node.Subquery?.QueryExpression is QuerySpecification query)
            {
                foreach (var split in query.FromClause?.TableReferences.OfType<GlobalFunctionTableReference>() ?? [])
                {
                    if (split.Name.Value.Equals("STRING_SPLIT", StringComparison.OrdinalIgnoreCase)
                        && split.Parameters.FirstOrDefault() is VariableReference variable)
                        Placeholders.Add(variable.Name.TrimStart('@'));
                }
            }
        }

        private static string ColumnName(ColumnReferenceExpression column) =>
            column.MultiPartIdentifier?.Identifiers.LastOrDefault()?.Value ?? "";

        private bool Matches(ColumnReferenceExpression column) =>
            column.ColumnType == ColumnType.Regular && aliases.Contains(Normalize(ColumnName(column)));
    }
}
