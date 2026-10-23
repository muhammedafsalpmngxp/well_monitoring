using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

public sealed record ViewFilterParamValue(string Name, object Value);

public sealed record ViewFilterResult(
    string Sql,
    IReadOnlyList<ViewFilterParamValue> Parameters,
    bool IsEmptyResult,
    bool HasUnsupportedAdditionalFilter = false
);

public static class ViewFilterHelper
{
    public static ViewFilterResult ApplyViewFilters(
        string sql,
        IReadOnlyList<ChartFilterParam> filters,
        int baseParamIndex = 0)
    {
        if (filters.Any(filter => filter.AdvancedHierarchy is not null && IsActive(filter)))
        {
            var advanced = AdvancedHierarchyViewFilter.Apply(
                sql, filters.Where(filter => filter.AdvancedHierarchy is not null && IsActive(filter)).ToList(), baseParamIndex);
            var regular = ApplyViewFilters(advanced.Sql, filters.Where(filter => filter.AdvancedHierarchy is null).ToList(),
                baseParamIndex + advanced.Parameters.Count);
            if (regular.IsEmptyResult) return regular;
            return regular with { Parameters = advanced.Parameters.Concat(regular.Parameters).ToList() };
        }

        var activeFilters = filters.Where(IsActive).ToList();
        if (activeFilters.Count == 0)
            return new ViewFilterResult(sql, [], IsEmptyResult: false);

        // Pre-validate additional filters
        foreach (var f in activeFilters.Where(f => f.DashboardAdditional))
        {
            var placeholder = ResolveChartFilterPlaceholder(sql, f);
            if (placeholder is null)
                return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: true);

            var values = GetEffectiveValues(f);
            if (values.Count > 1 && !HasSupportedPlaceholderPattern(sql, placeholder))
                return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: true);

            if (values.Count <= 1 && OverrideDeclaredPlaceholder(sql, placeholder, "@pCheck") == sql)
                return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: true);
        }

        var parameters = new List<ViewFilterParamValue>();
        var multiSelectFilters = new List<(ChartFilterParam Filter, string Placeholder, List<string> Values)>();
        var currentSql = sql;

        // Process single-selection filters first
        foreach (var filter in activeFilters)
        {
            var placeholder = ResolveChartFilterPlaceholder(currentSql, filter);
            if (placeholder is null)
            {
                if (filter.DashboardAdditional)
                    return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: true);
                continue;
            }

            var values = GetEffectiveValues(filter);
            if (values.Count == 0) continue;

            if (values.Count == 1)
            {
                var paramName = $"@p{baseParamIndex + parameters.Count}";
                var overridden = OverrideDeclaredPlaceholder(currentSql, placeholder, paramName);
                if (overridden == currentSql)
                {
                    if (filter.DashboardAdditional)
                        return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: true);
                    continue;
                }
                currentSql = overridden;
                parameters.Add(new ViewFilterParamValue(paramName, values[0]));
            }
            else
            {
                multiSelectFilters.Add((filter, placeholder, values));
            }
        }

        // If no multi-select filters, return pure scalar flow result (preserves original text unchanged)
        if (multiSelectFilters.Count == 0)
        {
            return new ViewFilterResult(currentSql, parameters, IsEmptyResult: false);
        }

        foreach (var (filter, placeholder, values) in multiSelectFilters)
        {
            var paramName = $"@p{baseParamIndex + parameters.Count}";
            var overridden = OverrideDeclaredPlaceholder(currentSql, placeholder, paramName);
            if (overridden == currentSql)
            {
                if (filter.DashboardAdditional)
                    return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: true);
                continue;
            }
            currentSql = overridden;
            parameters.Add(new ViewFilterParamValue(paramName, string.Join(",", values)));

            var parser = new TSql160Parser(initialQuotedIdentifiers: true);
            using var reader = new StringReader(currentSql);
            var fragment = parser.Parse(reader, out var errors);
            if (errors.Count > 0 || fragment is not TSqlScript script)
            {
                var hasAdditional = multiSelectFilters.Any(m => m.Filter.DashboardAdditional);
                return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: hasAdditional);
            }

            var detector = new PatternDetectorVisitor(placeholder);
            script.Accept(detector);
            var individualParamNames = new List<string>();
            if (values.Any(value => value.Contains(',')) || detector.HasLike)
            {
                foreach (var value in values)
                {
                    var valueParamName = $"@p{baseParamIndex + parameters.Count}";
                    individualParamNames.Add(valueParamName);
                    parameters.Add(new ViewFilterParamValue(valueParamName, value));
                }
            }

            var rewriter = new ViewMultiSelectAstRewriter(currentSql, placeholder, individualParamNames);
            script.Accept(rewriter);

            if (rewriter.MatchesCount == 0)
            {
                // Multi-select could not be translated to any equality/IN pattern
                return new ViewFilterResult(sql, [], IsEmptyResult: true, HasUnsupportedAdditionalFilter: filter.DashboardAdditional);
            }
            foreach (var edit in rewriter.Edits.OrderByDescending(edit => edit.Start))
                currentSql = currentSql.Remove(edit.Start, edit.Length).Insert(edit.Start, edit.Replacement);
        }

        return new ViewFilterResult(currentSql, parameters, IsEmptyResult: false);
    }

    public static bool CanApplyAdditionalFilters(string sql, IReadOnlyList<ChartFilterParam> filters)
    {
        var additionalFilters = filters.Where(f => f.DashboardAdditional).ToList();
        if (additionalFilters.Count == 0) return true;

        foreach (var filter in additionalFilters)
        {
            var placeholder = ResolveChartFilterPlaceholder(sql, filter);
            if (placeholder is null) return false;

            var effectiveValues = GetEffectiveValues(filter);
            if (effectiveValues.Count > 1)
            {
                if (!HasSupportedPlaceholderPattern(sql, placeholder))
                    return false;
            }
            else
            {
                if (OverrideDeclaredPlaceholder(sql, placeholder, "@pAdditional") == sql)
                    return false;
            }
        }

        return true;
    }

    public static bool HasSupportedPlaceholderPattern(string sql, string placeholder)
    {
        try
        {
            var parser = new TSql160Parser(initialQuotedIdentifiers: true);
            using var reader = new StringReader(sql);
            var fragment = parser.Parse(reader, out var errors);
            if (errors.Count > 0 || fragment is not TSqlScript script) return false;

            var detector = new PatternDetectorVisitor(placeholder);
            script.Accept(detector);
            return detector.Found || detector.HasNativeSplit;
        }
        catch
        {
            return false;
        }
    }

    public static List<string> GetEffectiveValues(ChartFilterParam filter)
    {
        if (filter.ControlType.Equals("MultiSelect", StringComparison.OrdinalIgnoreCase))
        {
            if (filter.Values is { Count: > 0 })
            {
                return filter.Values
                    .Where(v => !string.IsNullOrWhiteSpace(v) && !v.Equals("All", StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }
            if (!string.IsNullOrWhiteSpace(filter.Value) && !filter.Value.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                return filter.Value
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(v => !v.Equals("All", StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }
            return [];
        }

        if (filter.Values is { Count: > 0 })
        {
            return filter.Values
                .Where(v => !string.IsNullOrWhiteSpace(v) && !v.Equals("All", StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        if (!string.IsNullOrWhiteSpace(filter.Value) && !filter.Value.Equals("All", StringComparison.OrdinalIgnoreCase))
        {
            return [filter.Value];
        }

        return [];
    }

    public static bool IsActive(ChartFilterParam filter) =>
        GetEffectiveValues(filter).Count > 0;

    public static string? ResolveChartFilterPlaceholder(string sql, ChartFilterParam filter) =>
        FindDeclaredPlaceholder(sql, filter.Label)
        ?? FindDeclaredPlaceholder(sql, NormalizePlaceholderName(filter.Label))
        ?? FindDeclaredPlaceholder(sql, filter.SourceColumn)
        ?? FindDeclaredPlaceholder(sql, NormalizePlaceholderName(filter.SourceColumn))
        ?? FindDeclaredPlaceholder(sql, filter.SourceTable)
        ?? FindDeclaredPlaceholder(sql, NormalizePlaceholderName(filter.SourceTable))
        ?? FindPlantDescriptionPlaceholder(sql, filter);

    private static string? FindPlantDescriptionPlaceholder(string sql, ChartFilterParam filter)
    {
        var column = NormalizePlaceholderName(filter.SourceColumn);
        return string.Equals(column, "plant_description", StringComparison.OrdinalIgnoreCase)
            || string.Equals(column, "plantdescription", StringComparison.OrdinalIgnoreCase)
            ? FindDeclaredPlaceholder(sql, "plant")
            : null;
    }

    public static string? NormalizePlaceholderName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : Regex.Replace(name.Trim(), @"[\s-]+", "_");

    public static string? FindDeclaredPlaceholder(string sql, string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var clean = name.TrimStart('@');
        var m = Regex.Match(
            sql, $@"\bDECLARE\s+@({Regex.Escape(clean)})\b",
            RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value : null;
    }

    public static string OverrideDeclaredPlaceholder(string sql, string placeholder, string paramName)
    {
        var cleanPlaceholder = placeholder.TrimStart('@');
        var assignmentPattern =
            $@"\bSET\s+@{Regex.Escape(cleanPlaceholder)}\b\s*=\s*[^;]+;";
        var assignedSql = Regex.Replace(
            sql,
            assignmentPattern,
            $"SET @{cleanPlaceholder} = {paramName};",
            RegexOptions.IgnoreCase | RegexOptions.Singleline,
            TimeSpan.FromSeconds(1));
        if (assignedSql != sql) return assignedSql;

        return Regex.Replace(
            sql,
            $@"(DECLARE\s+@{Regex.Escape(cleanPlaceholder)}\b[^=;\r\n]*=\s*)([^;\r\n]+)(;?)",
            $"$1{paramName}$3",
            RegexOptions.IgnoreCase);
    }

    private sealed class PatternDetectorVisitor(string placeholderName) : TSqlFragmentVisitor
    {
        public bool Found { get; private set; }
        public bool HasLike { get; private set; }
        public bool HasNativeSplit { get; private set; }

        public override void Visit(GlobalFunctionTableReference node)
        {
            if (IsPlaceholderSplit(node, placeholderName))
                HasNativeSplit = true;
            base.Visit(node);
        }

        public override void Visit(LikePredicate node)
        {
            if (TryMatchLike(node, placeholderName, out _))
                HasLike = true;
            base.Visit(node);
        }

        public override void Visit(WhereClause node)
        {
            if (node.SearchCondition is not null && Matches(node.SearchCondition))
                Found = true;
            base.Visit(node);
        }

        public override void Visit(QualifiedJoin node)
        {
            if (node.SearchCondition is not null && Matches(node.SearchCondition))
                Found = true;
            base.Visit(node);
        }

        public override void Visit(HavingClause node)
        {
            if (node.SearchCondition is not null && Matches(node.SearchCondition))
                Found = true;
            base.Visit(node);
        }

        public override void Visit(SearchedWhenClause node)
        {
            if (node.WhenExpression is not null && Matches(node.WhenExpression))
                Found = true;
            base.Visit(node);
        }

        private bool Matches(BooleanExpression expr)
        {
            if (TryMatchNullGuarded(expr, placeholderName, out _) || TryMatchDirect(expr, placeholderName, out _)
                || TryMatchLike(expr, placeholderName, out _))
                return true;

            if (expr is BooleanParenthesisExpression paren)
                return Matches(paren.Expression);

            if (expr is BooleanBinaryExpression bin)
                return Matches(bin.FirstExpression) || Matches(bin.SecondExpression);

            if (expr is BooleanNotExpression notExpr)
                return Matches(notExpr.Expression);

            return false;
        }
    }

    private sealed record SqlTextEdit(int Start, int Length, string Replacement);

    private sealed class ViewMultiSelectAstRewriter(
        string sql, string placeholderName, IReadOnlyList<string> individualParamNames) : TSqlFragmentVisitor
    {
        public int MatchesCount { get; private set; }
        public List<SqlTextEdit> Edits { get; } = [];

        public override void Visit(GlobalFunctionTableReference node)
        {
            if (IsPlaceholderSplit(node, placeholderName)
                && !Edits.Any(edit => edit.Start <= node.StartOffset
                    && edit.Start + edit.Length >= node.StartOffset + node.FragmentLength))
            {
                // A selection CTE already consumes the list; preserve its normalization and predicates.
                if (individualParamNames.Count > 0)
                {
                    var alias = node.Alias is null
                        ? "[__selected_values]"
                        : sql.Substring(node.Alias.StartOffset, node.Alias.FragmentLength);
                    var rows = string.Join(" UNION ALL ",
                        individualParamNames.Select(parameter => $"SELECT {parameter} AS [value]"));
                    Edits.Add(new SqlTextEdit(node.StartOffset, node.FragmentLength, $"({rows}) AS {alias}"));
                }
                MatchesCount++;
            }
            base.Visit(node);
        }

        public override void Visit(WhereClause node)
        {
            if (node.SearchCondition is not null)
                CollectEdits(node.SearchCondition);
            base.Visit(node);
        }

        public override void Visit(QualifiedJoin node)
        {
            if (node.SearchCondition is not null)
                CollectEdits(node.SearchCondition);
            base.Visit(node);
        }

        public override void Visit(HavingClause node)
        {
            if (node.SearchCondition is not null)
                CollectEdits(node.SearchCondition);
            base.Visit(node);
        }

        public override void Visit(SearchedWhenClause node)
        {
            if (node.WhenExpression is not null)
                CollectEdits(node.WhenExpression);
            base.Visit(node);
        }

        private void CollectEdits(BooleanExpression expr)
        {
            if (TryMatchLike(expr, placeholderName, out var references))
            {
                var alternatives = individualParamNames.Select(parameter =>
                {
                    var predicate = sql.Substring(expr.StartOffset, expr.FragmentLength);
                    foreach (var reference in references.OrderByDescending(reference => reference.StartOffset))
                        predicate = predicate.Remove(reference.StartOffset - expr.StartOffset, reference.FragmentLength)
                            .Insert(reference.StartOffset - expr.StartOffset, parameter);
                    return predicate;
                });
                Edits.Add(new SqlTextEdit(expr.StartOffset, expr.FragmentLength,
                    $"({string.Join(" OR ", alternatives)})"));
                MatchesCount++;
                return;
            }

            if (expr is BooleanParenthesisExpression paren)
            {
                if (TryMatchNullGuarded(paren.Expression, placeholderName, out var colExpr))
                {
                    AddEdit(paren, colExpr);
                    return;
                }
                if (TryMatchDirect(paren.Expression, placeholderName, out colExpr))
                {
                    AddEdit(paren, colExpr);
                    return;
                }
                CollectEdits(paren.Expression);
                return;
            }

            if (expr is BooleanBinaryExpression binOr && binOr.BinaryExpressionType == BooleanBinaryExpressionType.Or)
            {
                if (TryMatchNullGuarded(binOr, placeholderName, out var colExpr))
                {
                    AddEdit(binOr, colExpr);
                    return;
                }
            }

            if (TryMatchDirect(expr, placeholderName, out var directColExpr))
            {
                AddEdit(expr, directColExpr);
                return;
            }

            if (expr is BooleanBinaryExpression bin)
            {
                CollectEdits(bin.FirstExpression);
                CollectEdits(bin.SecondExpression);
                return;
            }

            if (expr is BooleanNotExpression notExpr)
                CollectEdits(notExpr.Expression);
        }

        private void AddEdit(BooleanExpression matchedExpression, ScalarExpression columnExpression)
        {
            var column = sql.Substring(columnExpression.StartOffset, columnExpression.FragmentLength);
            var replacement = individualParamNames.Count > 0
                ? $"({column} IN ({string.Join(", ", individualParamNames)}))"
                : $"({column} IN (SELECT LTRIM(RTRIM([value])) FROM STRING_SPLIT(@{placeholderName.TrimStart('@')}, ',')))";
            Edits.Add(new SqlTextEdit(matchedExpression.StartOffset, matchedExpression.FragmentLength, replacement));
            MatchesCount++;
        }
    }

    private static bool IsPlaceholderSplit(GlobalFunctionTableReference split, string placeholderName) =>
        split.Name.Value.Equals("STRING_SPLIT", StringComparison.OrdinalIgnoreCase)
        && split.Parameters.Count == 2
        && split.Parameters[0] is VariableReference variable
        && IsMatchingVariable(variable.Name, placeholderName)
        && split.Parameters[1] is StringLiteral { Value: "," };

    private sealed class PlaceholderReferenceVisitor(string placeholderName) : TSqlFragmentVisitor
    {
        public List<VariableReference> References { get; } = [];

        public override void Visit(VariableReference node)
        {
            if (IsMatchingVariable(node.Name, placeholderName))
                References.Add(node);
            base.Visit(node);
        }
    }

    private static bool TryMatchLike(
        BooleanExpression expression, string placeholderName, out List<VariableReference> references)
    {
        references = [];
        if (expression is not LikePredicate { NotDefined: false } like)
            return false;

        var input = new PlaceholderReferenceVisitor(placeholderName);
        like.FirstExpression.Accept(input);
        if (input.References.Count > 0)
            return false;

        var pattern = new PlaceholderReferenceVisitor(placeholderName);
        like.SecondExpression.Accept(pattern);
        references = pattern.References;
        return references.Count > 0;
    }

    private static bool TryMatchNullGuarded(
        BooleanExpression expr, string placeholderName, [NotNullWhen(true)] out ScalarExpression? columnExpression)
    {
        columnExpression = null;
        expr = UnwrapParentheses(expr);

        if (expr is not BooleanBinaryExpression { BinaryExpressionType: BooleanBinaryExpressionType.Or } binOr)
            return false;

        var left = UnwrapParentheses(binOr.FirstExpression);
        var right = UnwrapParentheses(binOr.SecondExpression);

        if (IsPlaceholderIsNull(left, placeholderName) && TryExtractColumn(right, placeholderName, out columnExpression))
            return true;

        if (IsPlaceholderIsNull(right, placeholderName) && TryExtractColumn(left, placeholderName, out columnExpression))
            return true;

        return false;
    }

    private static bool TryMatchDirect(
        BooleanExpression expr, string placeholderName, [NotNullWhen(true)] out ScalarExpression? columnExpression)
    {
        return TryExtractColumn(expr, placeholderName, out columnExpression);
    }

    private static bool IsPlaceholderIsNull(BooleanExpression expr, string placeholderName)
    {
        expr = UnwrapParentheses(expr);
        return expr is BooleanIsNullExpression { IsNot: false } isNull
            && isNull.Expression is VariableReference varRef
            && IsMatchingVariable(varRef.Name, placeholderName);
    }

    private static bool TryExtractColumn(
        BooleanExpression expr, string placeholderName, [NotNullWhen(true)] out ScalarExpression? columnExpression)
    {
        columnExpression = null;
        expr = UnwrapParentheses(expr);

        if (expr is BooleanComparisonExpression { ComparisonType: BooleanComparisonType.Equals } comp)
        {
            if (comp.FirstExpression is VariableReference v1 && IsMatchingVariable(v1.Name, placeholderName))
            {
                columnExpression = comp.SecondExpression;
                return true;
            }
            if (comp.SecondExpression is VariableReference v2 && IsMatchingVariable(v2.Name, placeholderName))
            {
                columnExpression = comp.FirstExpression;
                return true;
            }
        }
        else if (expr is InPredicate { NotDefined: false } inPred)
        {
            if (inPred.Values.Count == 1 && inPred.Values[0] is VariableReference v && IsMatchingVariable(v.Name, placeholderName))
            {
                columnExpression = inPred.Expression;
                return true;
            }
            if (inPred.Subquery is not null && IsSplitValuesQuery(inPred.Subquery.QueryExpression, placeholderName))
            {
                columnExpression = inPred.Expression;
                return true;
            }
        }

        return false;
    }

    private static bool IsSplitValuesQuery(QueryExpression query, string placeholderName)
    {
        if (query is not QuerySpecification
            {
                WhereClause: null, GroupByClause: null, HavingClause: null,
                TopRowFilter: null, OrderByClause: null, OffsetClause: null, ForClause: null
            } select
            || select.SelectElements.Count != 1
            || select.SelectElements[0] is not SelectScalarExpression projection
            || !IsSplitValueProjection(projection.Expression)
            || select.FromClause?.TableReferences.Count != 1
            || select.FromClause.TableReferences[0] is not GlobalFunctionTableReference split
            || !split.Name.Value.Equals("STRING_SPLIT", StringComparison.OrdinalIgnoreCase)
            || split.Parameters.Count != 2
            || split.Parameters[0] is not VariableReference variable
            || !IsMatchingVariable(variable.Name, placeholderName)
            || split.Parameters[1] is not StringLiteral { Value: "," })
            return false;

        return true;
    }

    private static bool IsSplitValueProjection(ScalarExpression expression)
    {
        if (expression is ColumnReferenceExpression column)
            return column.MultiPartIdentifier?.Identifiers.Count == 1
                && column.MultiPartIdentifier.Identifiers[0].Value.Equals("value", StringComparison.OrdinalIgnoreCase);

        return expression is FunctionCall { Parameters.Count: 1, CallTarget: null } function
            && (function.FunctionName.Value.Equals("LTRIM", StringComparison.OrdinalIgnoreCase)
                || function.FunctionName.Value.Equals("RTRIM", StringComparison.OrdinalIgnoreCase))
            && IsSplitValueProjection(function.Parameters[0]);
    }

    private static BooleanExpression UnwrapParentheses(BooleanExpression expr)
    {
        while (expr is BooleanParenthesisExpression paren)
            expr = paren.Expression;
        return expr;
    }

    private static bool IsMatchingVariable(string varName, string placeholderName) =>
        varName.TrimStart('@').Equals(placeholderName.TrimStart('@'), StringComparison.OrdinalIgnoreCase);
}