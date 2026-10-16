using System.Data.Common;
using System.Globalization;
using System.Text;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Repositories;

/// <summary>
/// Turns <see cref="ReportFilter"/> conditions into a parameterised SQL predicate.
///
/// Security contract — every rule here exists because filter values come from end users:
///
///   * Operand values are ALWAYS bound as parameters. No caller value is ever concatenated
///     into the SQL text, including for LIKE (wildcards are added to the parameter value,
///     not to the SQL) and IN (each element gets its own parameter).
///   * The SQL fragment for an operator is selected from a closed switch on a validated
///     constant. The caller's operator string never reaches the query.
///   * Identifiers are validated by the caller (<c>IsValidIdentifier</c>) and additionally
///     bracket-escaped here, so a name that slipped through cannot break out of [ ].
///
/// The builder produces a fragment only; the caller decides where it lands (WHERE on a table
/// source, or an outer wrapper around a view's SQL).
/// </summary>
public static class FilterPredicateBuilder
{
    /// <summary>Marker value meaning "no filter", emitted by the UI's default dropdown state.</summary>
    private const string AllSentinel = "All";

    public sealed record Result(string Sql, IReadOnlyList<DbParameter> Parameters, IReadOnlyList<string> Skipped);

    /// <summary>
    /// Builds a predicate over the supplied filters.
    /// </summary>
    /// <param name="filters">Conditions, applied in order with their connectors.</param>
    /// <param name="alias">Table alias to qualify columns with, or null for unqualified.</param>
    /// <param name="createParameter">Factory for a provider-specific parameter.</param>
    /// <param name="startIndex">First parameter ordinal, so several builders can share a command.</param>
    /// <param name="columnExists">
    /// Optional guard. A saved filter may name a column that was since renamed or dropped;
    /// returning false skips that condition rather than failing the whole chart.
    /// </param>
    public static Result Build(
        IReadOnlyList<ReportFilter> filters,
        string? alias,
        Func<DbParameter> createParameter,
        int startIndex = 0,
        Func<string, bool>? columnExists = null)
    {
        var sql = new StringBuilder();
        var parameters = new List<DbParameter>();
        var skipped = new List<string>();
        var next = startIndex;

        foreach (var filter in filters)
        {
            if (!FilterOperators.IsSupported(filter.Operator))
            {
                skipped.Add($"{filter.Field}: unsupported operator '{filter.Operator}'");
                continue;
            }

            if (columnExists is not null && !columnExists(filter.Field))
            {
                skipped.Add($"{filter.Field}: column not found");
                continue;
            }

            var fragment = BuildOne(filter, alias, createParameter, ref next, parameters, skipped);
            if (fragment is null) continue;

            if (sql.Length > 0)
            {
                var connector = FilterConnectors.IsSupported(filter.Connector)
                    ? filter.Connector.Trim().ToUpperInvariant()
                    : "AND";
                sql.Append(' ').Append(connector).Append(' ');
            }

            sql.Append(fragment);
        }

        return new Result(sql.ToString(), parameters, skipped);
    }

    private static string? BuildOne(
        ReportFilter filter, string? alias, Func<DbParameter> createParameter,
        ref int next, List<DbParameter> parameters, List<string> skipped)
    {
        var column = Qualify(alias, filter.Field);
        var op = filter.Operator.Trim().ToLowerInvariant();

        // A relative date window overrides whatever operator was supplied — it always
        // resolves to a half-open range, which is what makes "last 30 days" keep meaning
        // that rather than freezing the dates it was saved with.
        if (!string.IsNullOrWhiteSpace(filter.RelativeRange))
        {
            if (!RelativeDateRanges.IsSupported(filter.RelativeRange))
            {
                skipped.Add($"{filter.Field}: unsupported relative range '{filter.RelativeRange}'");
                return null;
            }

            var (from, to) = ResolveRelativeRange(filter.RelativeRange!, filter.RelativeCount);
            var pFrom = Bind(createParameter, ref next, parameters, from);
            var pTo = Bind(createParameter, ref next, parameters, to);

            // >= from AND < to: a half-open range includes every time on the final day
            // without needing to know the column's precision.
            return $"({column} >= {pFrom} AND {column} < {pTo})";
        }

        var values = (filter.Values ?? [])
            .Where(v => v is not null)
            .Select(v => v.Trim())
            .Where(v => v.Length > 0 && !v.Equals(AllSentinel, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (FilterOperators.TakesValue(op) && values.Count == 0)
        {
            // Not an error: an untouched dropdown legitimately means "no filter".
            return null;
        }

        switch (op)
        {
            case FilterOperators.IsBlank:
                // Treats empty string as blank too — a user filtering for "blank" means both.
                // TRY_CAST because a direct <> '' throws on non-text columns such as
                // uniqueidentifier, and the builder does not know the column's type.
                return $"({column} IS NULL OR TRY_CAST({column} AS nvarchar(max)) = '')";

            case FilterOperators.IsNotBlank:
                return $"({column} IS NOT NULL AND TRY_CAST({column} AS nvarchar(max)) <> '')";

            case FilterOperators.IsTrue:
                return $"({column} = 1)";

            case FilterOperators.IsFalse:
                return $"({column} = 0)";

            case FilterOperators.Between:
                if (values.Count < 2)
                {
                    skipped.Add($"{filter.Field}: between needs two values");
                    return null;
                }
                var lo = Bind(createParameter, ref next, parameters, Coerce(values[0]));
                var hi = Bind(createParameter, ref next, parameters, Coerce(values[1]));
                return $"({column} BETWEEN {lo} AND {hi})";

            case FilterOperators.In:
            case FilterOperators.NotIn:
            {
                // Each element is its own parameter — never joined into the SQL text.
                // An explicit loop because `next` is a ref parameter and cannot be captured.
                var names = new List<string>(values.Count);
                foreach (var v in values)
                    names.Add(Bind(createParameter, ref next, parameters, Coerce(v)));
                var list = string.Join(", ", names);
                return op == FilterOperators.In
                    ? $"({column} IN ({list}))"
                    : $"({column} IS NULL OR {column} NOT IN ({list}))";
            }

            case FilterOperators.Contains:
            case FilterOperators.NotContains:
            case FilterOperators.StartsWith:
            case FilterOperators.EndsWith:
            {
                // Wildcards are added to the VALUE, so a user typing % cannot widen the match.
                var raw = EscapeLikeWildcards(values[0]);
                var pattern = op switch
                {
                    FilterOperators.StartsWith => raw + "%",
                    FilterOperators.EndsWith => "%" + raw,
                    _ => "%" + raw + "%"
                };
                var p = Bind(createParameter, ref next, parameters, pattern);
                var negate = op == FilterOperators.NotContains;

                // ESCAPE declares the character used above, so a literal % or _ stays literal.
                return negate
                    ? $"({column} IS NULL OR {column} NOT LIKE {p} ESCAPE '\\')"
                    : $"({column} LIKE {p} ESCAPE '\\')";
            }

            default:
            {
                var sqlOp = op switch
                {
                    FilterOperators.Equals => "=",
                    FilterOperators.NotEquals => "<>",
                    FilterOperators.GreaterThan => ">",
                    FilterOperators.GreaterOrEqual => ">=",
                    FilterOperators.LessThan => "<",
                    FilterOperators.LessOrEqual => "<=",
                    _ => null
                };

                if (sqlOp is null)
                {
                    skipped.Add($"{filter.Field}: operator '{op}' has no SQL mapping");
                    return null;
                }

                // Several values with a scalar operator is how the UI expresses multi-select,
                // so treat it as IN rather than silently using only the first.
                if (values.Count > 1 && sqlOp is "=" or "<>")
                {
                    var names = new List<string>(values.Count);
                    foreach (var v in values)
                        names.Add(Bind(createParameter, ref next, parameters, Coerce(v)));
                    var list = string.Join(", ", names);
                    return sqlOp == "="
                        ? $"({column} IN ({list}))"
                        : $"({column} IS NULL OR {column} NOT IN ({list}))";
                }

                var param = Bind(createParameter, ref next, parameters, Coerce(values[0]));

                // "not equals" must also return rows where the column is NULL, which a bare
                // <> would drop — almost never what a user filtering "is not X" expects.
                return sqlOp == "<>"
                    ? $"({column} IS NULL OR {column} <> {param})"
                    : $"({column} {sqlOp} {param})";
            }
        }
    }

    /// <summary>
    /// Resolves a relative window to [from, to). Anchored on today's date so a saved filter
    /// keeps tracking the calendar instead of the moment it was created.
    /// </summary>
    public static (DateTime From, DateTime To) ResolveRelativeRange(string range, int? count)
    {
        var today = DateTime.UtcNow.Date;
        var n = count is > 0 ? count.Value : 1;

        return range.Trim().ToLowerInvariant() switch
        {
            RelativeDateRanges.Today => (today, today.AddDays(1)),
            RelativeDateRanges.Yesterday => (today.AddDays(-1), today),
            // Week starts Monday, matching the W1-W5 bucketing used elsewhere in the product.
            RelativeDateRanges.ThisWeek => (StartOfWeek(today), StartOfWeek(today).AddDays(7)),
            RelativeDateRanges.ThisMonth => (new DateTime(today.Year, today.Month, 1), new DateTime(today.Year, today.Month, 1).AddMonths(1)),
            RelativeDateRanges.ThisQuarter => QuarterRange(today),
            RelativeDateRanges.ThisYear => (new DateTime(today.Year, 1, 1), new DateTime(today.Year + 1, 1, 1)),
            // "Last N days" includes today, so N=1 means today alone.
            RelativeDateRanges.LastNDays => (today.AddDays(-(n - 1)), today.AddDays(1)),
            RelativeDateRanges.LastNMonths => (today.AddMonths(-n).AddDays(1), today.AddDays(1)),
            RelativeDateRanges.LastNYears => (today.AddYears(-n).AddDays(1), today.AddDays(1)),
            _ => (today, today.AddDays(1))
        };
    }

    private static DateTime StartOfWeek(DateTime date)
    {
        var offset = ((int)date.DayOfWeek + 6) % 7; // Monday = 0
        return date.AddDays(-offset);
    }

    private static (DateTime, DateTime) QuarterRange(DateTime date)
    {
        var startMonth = ((date.Month - 1) / 3) * 3 + 1;
        var start = new DateTime(date.Year, startMonth, 1);
        return (start, start.AddMonths(3));
    }

    /// <summary>
    /// Escapes LIKE metacharacters so a user searching for "50%" matches that literal text
    /// rather than every row. Paired with ESCAPE '\' in the emitted SQL.
    /// </summary>
    private static string EscapeLikeWildcards(string value) => value
        .Replace("\\", "\\\\")
        .Replace("%", "\\%")
        .Replace("_", "\\_")
        .Replace("[", "\\[");

    /// <summary>
    /// Binds a filter value as TEXT, deliberately, even when it looks like a number or a date.
    ///
    /// SQL Server's datatype precedence decides which side of a comparison is converted. Binding
    /// "30750" as a number against a varchar column makes the server convert THE COLUMN, row by
    /// row, and the whole query fails on the first value that is not numeric — a real varchar
    /// key column containing '0000I' does exactly that. Binding as text inverts it: against a
    /// numeric column the PARAMETER is converted once, which is both safe and index-friendly.
    ///
    /// The builder cannot see column types, so it cannot choose per column; text is the only
    /// binding that is correct for either kind.
    /// </summary>
    private static object Coerce(string value) => value;

    private static string Bind(Func<DbParameter> createParameter, ref int next, List<DbParameter> parameters, object value)
    {
        var name = $"@f{next++}";
        var p = createParameter();
        p.ParameterName = name;
        p.Value = value ?? DBNull.Value;
        parameters.Add(p);
        return name;
    }

    /// <summary>Bracket-escaped, optionally alias-qualified column reference.</summary>
    private static string Qualify(string? alias, string column)
    {
        var safe = $"[{column.Replace("]", "]]")}]";
        return string.IsNullOrWhiteSpace(alias) ? safe : $"{alias}.{safe}";
    }
}
