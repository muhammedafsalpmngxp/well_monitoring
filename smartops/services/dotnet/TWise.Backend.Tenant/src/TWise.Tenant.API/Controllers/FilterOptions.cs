using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Static catalogue of report-filter options served to the filter-builder UI.
///
/// Kept server-side so the client never hard-codes an operator list that could drift from what
/// <c>FilterPredicateBuilder</c> actually supports — a mismatch there produces filters that are
/// silently dropped.
/// </summary>
public static class FilterOptions
{
    public static readonly FilterOptionsResponse All = new(
        Operators:
        [
            new(FilterOperators.Equals,         "Equals",            "any"),
            new(FilterOperators.NotEquals,      "Not equals",        "any"),
            new(FilterOperators.GreaterThan,    "Greater than",      "number,date"),
            new(FilterOperators.GreaterOrEqual, "Greater or equal",  "number,date"),
            new(FilterOperators.LessThan,       "Less than",         "number,date"),
            new(FilterOperators.LessOrEqual,    "Less or equal",     "number,date"),
            new(FilterOperators.Between,        "Between",           "number,date", true, 2),
            new(FilterOperators.Contains,       "Contains",          "string"),
            new(FilterOperators.NotContains,    "Does not contain",  "string"),
            new(FilterOperators.StartsWith,     "Starts with",       "string"),
            new(FilterOperators.EndsWith,       "Ends with",         "string"),
            new(FilterOperators.In,             "Is any of",         "any", true, -1),
            new(FilterOperators.NotIn,          "Is none of",        "any", true, -1),
            new(FilterOperators.IsBlank,        "Is blank",          "any", false, 0),
            new(FilterOperators.IsNotBlank,     "Is not blank",      "any", false, 0),
            new(FilterOperators.IsTrue,         "Is true",           "boolean", false, 0),
            new(FilterOperators.IsFalse,        "Is false",          "boolean", false, 0)
        ],
        Connectors: FilterConnectors.All,
        Scopes: FilterScopes.All,
        RelativeRanges:
        [
            new(RelativeDateRanges.Today,       "Today",            "date", false, 0),
            new(RelativeDateRanges.Yesterday,   "Yesterday",        "date", false, 0),
            new(RelativeDateRanges.ThisWeek,    "This week",        "date", false, 0),
            new(RelativeDateRanges.ThisMonth,   "This month",       "date", false, 0),
            new(RelativeDateRanges.ThisQuarter, "This quarter",     "date", false, 0),
            new(RelativeDateRanges.ThisYear,    "This year",        "date", false, 0),
            // These take N — the UI shows a number box alongside.
            new(RelativeDateRanges.LastNDays,   "Last N days",      "date", true, 1),
            new(RelativeDateRanges.LastNMonths, "Last N months",    "date", true, 1),
            new(RelativeDateRanges.LastNYears,  "Last N years",     "date", true, 1)
        ]);
}
