using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Static definition of all View Builder dropdown options.
/// These are the available SQL constructs the UI can use to build dynamic queries.
/// </summary>
public static class ViewBuilderOptions
{
    public static readonly ViewBuilderOptionsResponse All = new(
        JoinTypes: new List<ViewBuilderEnumOption>
        {
            new("INNER", "INNER JOIN", "Returns only rows with matching values in both tables"),
            new("LEFT", "LEFT JOIN", "Returns all rows from the left table and matched rows from the right"),
            new("RIGHT", "RIGHT JOIN", "Returns all rows from the right table and matched rows from the left"),
            new("FULL", "FULL JOIN", "Returns all rows when there is a match in either table"),
            new("CROSS", "CROSS JOIN", "Returns the Cartesian product of both tables (no ON condition)")
        },
        FilterOperators: new List<ViewBuilderEnumOption>
        {
            new("=", "= (equals)", "Exact match"),
            new("<>", "≠ (not equals)", "Not equal to"),
            new(">", "> (greater than)", "Greater than"),
            new("<", "< (less than)", "Less than"),
            new(">=", "≥ (greater or equal)", "Greater than or equal to"),
            new("<=", "≤ (less or equal)", "Less than or equal to"),
            new("LIKE", "LIKE (contains)", "Pattern match with wildcards (%)"),
            new("NOT LIKE", "NOT LIKE", "Does not match pattern"),
            new("IN", "IN (list)", "Matches any value in a comma-separated list"),
            new("NOT IN", "NOT IN", "Does not match any value in the list"),
            new("BETWEEN", "BETWEEN", "Within a range (value format: 'min AND max')"),
            new("IS NULL", "IS NULL", "Column value is null"),
            new("IS NOT NULL", "IS NOT NULL", "Column value is not null")
        },
        LogicalConnectors: new List<ViewBuilderEnumOption>
        {
            new("AND", "AND", "Both conditions must be true"),
            new("OR", "OR", "Either condition must be true")
        },
        SortDirections: new List<ViewBuilderEnumOption>
        {
            new("ASC", "Ascending", "Sort from lowest to highest"),
            new("DESC", "Descending", "Sort from highest to lowest")
        }
    );
}
