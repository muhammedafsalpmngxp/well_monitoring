using System.Globalization;
using System.Text.RegularExpressions;

namespace TWise.Tenant.Application.Features.Model.Query;

/// <summary>
/// Prints a measure or calculated-column tree as formula text, stored in ExpressionText of model.Measure
/// and model.CalculatedColumn. The tree stays the source of truth and the server never parses text: the
/// browser's printMeasure (src/app/core/utils/measure-syntax.util.ts) prints the same text, and its
/// parsers read that text back into the same tree. MeasureTextTests pins the cases both printers must
/// agree on.
/// </summary>
public static class MeasureText
{
    private static readonly Dictionary<string, string> Functions = new(StringComparer.OrdinalIgnoreCase)
    {
        ["sum"] = "SUM", ["avg"] = "AVG", ["count"] = "COUNT", ["count_distinct"] = "DISTINCTCOUNT", ["min"] = "MIN", ["max"] = "MAX",
        ["count_rows"] = "COUNTROWS",
    };

    private static readonly Dictionary<string, string> Comparisons = new(StringComparer.OrdinalIgnoreCase)
    {
        ["eq"] = "=", ["neq"] = "<>", ["gt"] = ">", ["gte"] = ">=", ["lt"] = "<", ["lte"] = "<=",
    };

    // The row functions of calculated columns and the measure functions. Each prints as its code in capitals;
    // the browser's ROW_FUNCTION_NAMES and MEASURE_FUNCTION_NAMES hold the same codes.
    private static readonly HashSet<string> FunctionCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "concat", "left", "right", "upper", "lower", "trim", "year", "month",
        "if", "and", "or", "not", "isblank", "coalesce", "isnull", "iferror", "contains", "starts_with", "ends_with",
        "len", "replace", "substring", "split", "first_word", "last_word", "to_number", "to_date",
        "day", "quarter", "weekday", "month_name", "weekday_name", "month_start", "datediff", "today",
        "round", "abs", "floor", "ceiling", "min_of", "max_of",
        "percent_of_total", "running_total", "change", "change_pct", "rank", "ytd", "moving_avg", "threshold",
    };

    // \z, not $: in .NET, $ also matches before a final line break, which JavaScript's $ does not.
    private static readonly Regex PlainName = new(@"^[A-Za-z_][A-Za-z0-9_]*\z", RegexOptions.CultureInvariant);
    private static readonly Regex PlainNumber = new(@"^-?[0-9]+(\.[0-9]+)?\z", RegexOptions.CultureInvariant);

    /// <summary>The canonical text of a tree the compiler has accepted. Anything else throws ArgumentException.</summary>
    public static string Print(MeasureNode node) => node switch
    {
        AggregateNode a => $"{Lookup(Functions, a.Fn)}({Target(a)}{Where(a.Where)})",
        // The digits JavaScript's String() prints: no trailing zeros and no exponent.
        NumberNode n => n.Value.ToString("0.############################", CultureInfo.InvariantCulture),
        BinaryNode b => $"{Operand(b.Left, b.Op, isRight: false)} {b.Op} {Operand(b.Right, b.Op, isRight: true)}",
        // One comparison at a time: a comparison on either side of another is bracketed.
        CompareNode comparison => $"{Side(comparison.Left)} {Lookup(Comparisons, comparison.Op)} {Side(comparison.Right)}",
        ColumnNode c => Column(c),
        TextNode t => Text(t.Value),
        // Parts are separated by commas, so none of them needs brackets.
        FunctionNode f => $"{FunctionName(f.Fn)}({string.Join(", ", f.Args.Select(Print))})",
        // Always bracketed, so a measure never reads as a function or a table.
        MeasureRefNode r => "[" + r.Measure.Replace("]", "]]") + "]",
        _ => throw new ArgumentException("This part of the formula cannot be printed.", nameof(node)),
    };

    // COUNTROWS counts the rows of a table, so it names the table alone.
    private static string Target(AggregateNode a)
        => string.Equals(a.Fn, "count_rows", StringComparison.OrdinalIgnoreCase) ? Name(a.Arg.Source) : Column(a.Arg);

    private static string Side(MeasureNode child) => child is CompareNode ? $"({Print(child)})" : Print(child);

    private static string FunctionName(string fn)
        => FunctionCodes.Contains(fn) ? fn.ToUpperInvariant() : throw new ArgumentException($"\"{fn}\" cannot be printed.", nameof(fn));

    private static string Where(MeasureCondition? test)
        => test is null ? "" : $" WHERE {Column(test.Column)} {Lookup(Comparisons, test.Op)} {Value(test.Value)}";

    // Brackets keep the tree's shape: a looser operator always needs them, an equal one only on the right.
    private static string Operand(MeasureNode child, string parentOp, bool isRight)
    {
        var text = Print(child);
        // A comparison inside arithmetic is always bracketed.
        return child is CompareNode || (child is BinaryNode b && (Rank(b.Op) < Rank(parentOp) || (isRight && Rank(b.Op) == Rank(parentOp))))
            ? $"({text})"
            : text;
    }

    private static int Rank(string op) => op is "*" or "/" ? 2 : 1;

    private static string Column(ColumnNode c) => $"{Name(c.Source)}.{Name(c.Column)}";

    private static string Name(string name) => PlainName.IsMatch(name) ? name : "[" + name.Replace("]", "]]") + "]";

    // A condition value that reads as a number prints bare; a text value in a row formula is always quoted.
    private static string Value(string value) => PlainNumber.IsMatch(value) ? value : Text(value);

    private static string Text(string value) => "'" + value.Replace("'", "''") + "'";

    private static string Lookup(Dictionary<string, string> map, string key)
        => map.TryGetValue(key, out var text) ? text : throw new ArgumentException($"\"{key}\" cannot be printed.", nameof(key));
}
