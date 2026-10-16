namespace TWise.Tenant.Domain.DTOs;

/// <summary>
/// Operators a report-level filter can use. Closed set — the SQL fragment for each is chosen
/// by <c>FilterPredicateBuilder</c> from this value, never built from caller-supplied text.
/// </summary>
public static class FilterOperators
{
    // `new` because a member named Equals hides object.Equals; the name is worth keeping.
    public new const string Equals = "eq";
    public const string NotEquals = "neq";
    public const string GreaterThan = "gt";
    public const string GreaterOrEqual = "gte";
    public const string LessThan = "lt";
    public const string LessOrEqual = "lte";
    public const string Between = "between";
    public const string Contains = "contains";
    public const string NotContains = "notcontains";
    public const string StartsWith = "startswith";
    public const string EndsWith = "endswith";
    public const string In = "in";
    public const string NotIn = "notin";
    public const string IsBlank = "isblank";
    public const string IsNotBlank = "isnotblank";
    public const string IsTrue = "istrue";
    public const string IsFalse = "isfalse";

    public static readonly IReadOnlyList<string> All =
    [
        Equals, NotEquals, GreaterThan, GreaterOrEqual, LessThan, LessOrEqual, Between,
        Contains, NotContains, StartsWith, EndsWith, In, NotIn,
        IsBlank, IsNotBlank, IsTrue, IsFalse
    ];

    /// <summary>Operators that take no value — the UI hides the value box for these.</summary>
    public static readonly IReadOnlyList<string> Valueless = [IsBlank, IsNotBlank, IsTrue, IsFalse];

    public static bool IsSupported(string? op) =>
        op is not null && All.Contains(op.Trim().ToLowerInvariant());

    public static bool TakesValue(string op) =>
        !Valueless.Contains(op.Trim().ToLowerInvariant());
}

/// <summary>How a filter combines with the one before it.</summary>
public static class FilterConnectors
{
    public const string And = "and";
    public const string Or = "or";

    public static readonly IReadOnlyList<string> All = [And, Or];

    public static bool IsSupported(string? c) =>
        c is not null && All.Contains(c.Trim().ToLowerInvariant());
}

/// <summary>
/// How widely a filter applies. Scope is enforced by the caller deciding which filters to send
/// with a given widget's query; the server records it so a saved filter set round-trips intact.
/// </summary>
public static class FilterScopes
{
    /// <summary>One chart only.</summary>
    public const string Visual = "visual";

    /// <summary>Every visual on the dashboard page.</summary>
    public const string Page = "page";

    /// <summary>Every page of the report.</summary>
    public const string Report = "report";

    /// <summary>Applied at the data-source level, before any visual sees the rows.</summary>
    public const string Dataset = "dataset";

    public static readonly IReadOnlyList<string> All = [Visual, Page, Report, Dataset];

    public static bool IsSupported(string? s) =>
        s is not null && All.Contains(s.Trim().ToLowerInvariant());
}

/// <summary>
/// Relative date windows, resolved to a concrete range at query time so the same saved filter
/// keeps meaning "last 30 days" rather than freezing the dates it was created with.
/// </summary>
public static class RelativeDateRanges
{
    public const string Today = "today";
    public const string Yesterday = "yesterday";
    public const string ThisWeek = "thisweek";
    public const string ThisMonth = "thismonth";
    public const string ThisQuarter = "thisquarter";
    public const string ThisYear = "thisyear";

    /// <summary>Used with <see cref="ReportFilter.RelativeCount"/>.</summary>
    public const string LastNDays = "lastndays";
    public const string LastNMonths = "lastnmonths";
    public const string LastNYears = "lastnyears";

    public static readonly IReadOnlyList<string> All =
    [
        Today, Yesterday, ThisWeek, ThisMonth, ThisQuarter, ThisYear,
        LastNDays, LastNMonths, LastNYears
    ];

    public static bool IsSupported(string? r) =>
        r is not null && All.Contains(r.Trim().ToLowerInvariant());

    public static bool NeedsCount(string r) =>
        r.Trim().ToLowerInvariant() is LastNDays or LastNMonths or LastNYears;
}

/// <summary>
/// One report-level filter condition.
///
/// Distinct from the View Builder's filters, which are baked into a view's stored SQL: these are
/// applied at query time, so the same chart can be re-filtered without editing its source.
/// </summary>
/// <param name="Field">Column to filter on. Validated as an identifier before use.</param>
/// <param name="Operator">See <see cref="FilterOperators"/>. Defaults to equals.</param>
/// <param name="Values">
/// Operand(s). Empty for valueless operators, two entries for <c>between</c>, many for <c>in</c>.
/// </param>
/// <param name="Connector">How this joins to the previous condition — and | or.</param>
/// <param name="Scope">visual | page | report | dataset.</param>
/// <param name="SourceTable">Owning table when the filter targets a different table to the chart.</param>
/// <param name="RelativeRange">
/// When set, the filter is a date window and <paramref name="Values"/> is ignored.
/// </param>
/// <param name="RelativeCount">N for lastNDays / lastNMonths / lastNYears.</param>
/// <param name="Label">Display name, and the view placeholder to override where one exists.</param>
public record ReportFilter(
    string Field,
    string Operator = FilterOperators.Equals,
    IReadOnlyList<string>? Values = null,
    string Connector = FilterConnectors.And,
    string Scope = FilterScopes.Visual,
    string? SourceTable = null,
    string? RelativeRange = null,
    int? RelativeCount = null,
    string? Label = null
);

/// <summary>Top N / Bottom N applied after filtering.</summary>
/// <param name="Direction">top | bottom.</param>
/// <param name="Count">How many rows to keep.</param>
/// <param name="OrderBy">Column ranked on. Validated as an identifier.</param>
public record TopNSpec(string Direction, int Count, string OrderBy)
{
    public const string Top = "top";
    public const string Bottom = "bottom";

    public bool IsBottom => Direction.Trim().Equals(Bottom, StringComparison.OrdinalIgnoreCase);

    public bool IsValid =>
        Count > 0
        && !string.IsNullOrWhiteSpace(OrderBy)
        && (Direction.Trim().Equals(Top, StringComparison.OrdinalIgnoreCase) || IsBottom);
}

/// <summary>Options offered to the filter-builder UI, so the client hard-codes nothing.</summary>
public record FilterOptionsResponse(
    IReadOnlyList<FilterOperatorOption> Operators,
    IReadOnlyList<string> Connectors,
    IReadOnlyList<string> Scopes,
    IReadOnlyList<FilterOperatorOption> RelativeRanges
);

/// <param name="TakesValue">False for operators like isBlank, so the UI hides the value input.</param>
/// <param name="ValueCount">How many operands: 1 normally, 2 for between, -1 for a list.</param>
public record FilterOperatorOption(
    string Value,
    string Label,
    string AppliesTo,
    bool TakesValue = true,
    int ValueCount = 1
);
