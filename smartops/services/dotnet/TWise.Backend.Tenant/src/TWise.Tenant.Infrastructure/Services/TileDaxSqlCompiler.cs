using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class TileDaxSqlCompiler
{
    private readonly List<SqlParameter> parameters = [];
    private int nodes;

    public (string Sql, IReadOnlyList<SqlParameter> Parameters) Compile(JsonElement expression, string? scope, string sourceSql)
    {
        parameters.Clear();
        nodes = 0;
        if (scope is not (null or "column" or "row")) throw new ArgumentException("Invalid DAX evaluation scope.");
        var value = scope == "row"
            ? $"(SELECT SUM(_dax_row.[value]) FROM [_tile_dax_source] CROSS APPLY (SELECT {Number(Render(expression, true, 0))} AS [value]) _dax_row)"
            : Render(expression, false, 0);
        return ($"WITH [_tile_dax_source] AS ({sourceSql}) SELECT CASE WHEN EXISTS (SELECT 1 FROM [_tile_dax_source]) THEN {Number(value)} ELSE 0.0 END AS [Value]", parameters.ToArray());
    }

    private string Render(JsonElement node, bool row, int depth)
    {
        try
        {
            var sql = RenderNode(node, row, depth);
            if (sql.Length > 64000) throw new ArgumentException("DAX expression is too complex.");
            return sql;
        }
        catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException or FormatException)
        {
            throw new ArgumentException("Malformed DAX expression.", ex);
        }
    }

    private string RenderNode(JsonElement node, bool row, int depth)
    {
        if (++nodes > 512 || depth > 32 || node.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("DAX expression is too complex or malformed.");
        string Child(JsonElement value) => Render(value, row, depth + 1);
        switch (node.GetProperty("kind").GetString())
        {
            case "literal":
                var value = node.GetProperty("value");
                object parameter = value.ValueKind switch
                {
                    JsonValueKind.Null => DBNull.Value,
                    JsonValueKind.True => 1,
                    JsonValueKind.False => 0,
                    JsonValueKind.Number when value.TryGetDouble(out var number) && double.IsFinite(number) => number,
                    JsonValueKind.String when value.GetString()!.Length <= 4000 => value.GetString()!,
                    _ => throw new ArgumentException("Invalid DAX literal."),
                };
                var name = $"@tileDax{parameters.Count}";
                parameters.Add(new SqlParameter(name, parameter));
                return name;
            case "column":
                var column = node.GetProperty("name").GetString();
                if (string.IsNullOrWhiteSpace(column) || column.Length > 128 || column.Any(char.IsControl))
                    throw new ArgumentException("Invalid DAX column.");
                var quoted = $"[{column.Replace("]", "]]")}]";
                return row ? quoted : $"(SELECT TOP 1 {quoted} FROM [_tile_dax_source])";
            case "unary":
                if (node.GetProperty("operator").GetString() != "-") throw new ArgumentException("Invalid DAX unary operator.");
                return $"(-{Number(Child(node.GetProperty("value")))})";
            case "binary":
                var left = Child(node.GetProperty("left"));
                var right = Child(node.GetProperty("right"));
                return node.GetProperty("operator").GetString() switch
                {
                    "+" => $"({Number(left)} + {Number(right)})",
                    "-" => $"({Number(left)} - {Number(right)})",
                    "*" => $"({Number(left)} * {Number(right)})",
                    "/" => $"COALESCE({Number(left)} / NULLIF({Number(right)}, 0), 0)",
                    "^" => $"POWER({Number(left)}, {Number(right)})",
                    "&" => $"CONCAT({left}, {right})",
                    "=" or "==" => $"CASE WHEN {left} = {right} THEN 1 ELSE 0 END",
                    "<>" or "!=" => $"CASE WHEN {left} <> {right} THEN 1 ELSE 0 END",
                    ">" => $"CASE WHEN {left} > {right} THEN 1 ELSE 0 END",
                    ">=" => $"CASE WHEN {left} >= {right} THEN 1 ELSE 0 END",
                    "<" => $"CASE WHEN {left} < {right} THEN 1 ELSE 0 END",
                    "<=" => $"CASE WHEN {left} <= {right} THEN 1 ELSE 0 END",
                    _ => throw new ArgumentException("Invalid DAX operator."),
                };
            case "function":
                return Function(node.GetProperty("name").GetString() ?? "", node.GetProperty("args").EnumerateArray().ToArray(), row, depth + 1);
            default:
                throw new ArgumentException("Invalid DAX expression node.");
        }
    }

    private string Function(string name, JsonElement[] args, bool row, int depth)
    {
        name = name.ToUpperInvariant();
        if (args.Length > 32) throw new ArgumentException("Too many DAX arguments.");
        if (name is "COUNTROWS")
        {
            Require(args, 0, 0);
            return row ? "1" : "(SELECT COUNT_BIG(*) FROM [_tile_dax_source])";
        }
        if (name is "SUM" or "PRODUCT" or "AVERAGE" or "MIN" or "MAX" or "COUNT" or "DISTINCTCOUNT" or "MEDIAN"
            or "STDEV" or "VARIANCE" or "PERCENTILE" or "COUNTBLANK" or "DISTINCTCOUNTNOBLANK"
            or "STDEV.S" or "STDEV.P" or "VAR.S" or "VAR.P" or "PERCENTILE.INC")
            return Aggregate(name, args, row, depth);

        var arity = name switch
        {
            "BLANK" or "TRUE" or "FALSE" or "TODAY" or "NOW" => (0, 0),
            "IF" or "DIVIDE" => (2, 3),
            "SWITCH" => (3, 32),
            "COALESCE" or "CONCATENATE" => (1, 32),
            "AND" or "OR" => (2, 2),
            "ROUND" or "LEFT" or "RIGHT" or "WEEKDAY" => (1, 2),
            "IFERROR" or "PERCENTAGE" or "EXACT" or "EOMONTH" => (2, 2),
            "FIND" or "SEARCH" => (2, 4),
            "MID" or "SUBSTITUTE" or "DATE" or "DATEDIFF" => (3, 3),
            "ISBLANK" or "NOT" or "ABS" or "LEN" or "UPPER" or "LOWER" or "TRIM" or "VALUE"
                or "DATEVALUE" or "YEAR" or "MONTH" or "DAY" or "QUARTER" => (1, 1),
            _ => throw new ArgumentException($"DAX function {name} is not supported for server-side tiles."),
        };
        Require(args, arity.Item1, arity.Item2);
        var values = args.Select(argument => Render(argument, row, depth + 1)).ToArray();
        string Arg(int index, string fallback = "0") => index < values.Length ? values[index] : fallback;
        string Numeric(int index, string fallback = "0") => Number(Arg(index, fallback));
        string Date(int index) => $"TRY_CONVERT(datetime2, {Arg(index)})";
        switch (name)
        {
            case "BLANK": return "NULL";
            case "TRUE": return "1";
            case "FALSE": return "0";
            case "IF": return $"CASE WHEN {Numeric(0)} <> 0 THEN {Arg(1)} ELSE {Arg(2)} END";
            case "DIVIDE": return $"COALESCE({Numeric(0)} / NULLIF({Numeric(1)}, 0), {Numeric(2)})";
            case "PERCENTAGE": return $"COALESCE(100.0 * {Numeric(0)} / NULLIF({Numeric(1)}, 0), 0)";
            case "SWITCH":
                var branches = new List<string>();
                for (var index = 1; index + 1 < values.Length; index += 2)
                    branches.Add($"WHEN {Arg(0)} = {Arg(index)} THEN {Arg(index + 1)}");
                return $"CASE {string.Join(" ", branches)} ELSE {(values.Length % 2 == 0 ? values[^1] : "0")} END";
            case "COALESCE": return $"COALESCE({string.Join(", ", values.Select(value => $"CASE WHEN DATALENGTH(CONVERT(nvarchar(max), {value})) = 0 THEN NULL ELSE {value} END"))}, NULL)";
            case "IFERROR": return $"COALESCE(TRY_CONVERT(float, {Arg(0)}), {Arg(1)})";
            case "ISBLANK": return $"CASE WHEN {Arg(0)} IS NULL THEN 1 ELSE 0 END";
            case "NOT": return $"CASE WHEN {Numeric(0)} = 0 THEN 1 ELSE 0 END";
            case "AND": return $"CASE WHEN {string.Join(" AND ", values.Select(value => Number(value) + " <> 0"))} THEN 1 ELSE 0 END";
            case "OR": return $"CASE WHEN {string.Join(" OR ", values.Select(value => Number(value) + " <> 0"))} THEN 1 ELSE 0 END";
            case "ROUND": return $"FLOOR({Numeric(0)} * POWER(10.0, {Numeric(1)}) + 0.5) / NULLIF(POWER(10.0, {Numeric(1)}), 0)";
            case "ABS": return $"ABS({Numeric(0)})";
            case "LEN": return $"LEN(CONCAT({Arg(0)}, '#')) - 1";
            case "LEFT": return $"LEFT(CONVERT(nvarchar(max), {Arg(0)}), CONVERT(int, {Numeric(1, "1")}))";
            case "RIGHT": return $"RIGHT(CONVERT(nvarchar(max), {Arg(0)}), CONVERT(int, {Numeric(1, "1")}))";
            case "MID": return $"SUBSTRING(CONVERT(nvarchar(max), {Arg(0)}), CONVERT(int, {Numeric(1)}), CONVERT(int, {Numeric(2)}))";
            case "UPPER": return $"UPPER(CONVERT(nvarchar(max), {Arg(0)}))";
            case "LOWER": return $"LOWER(CONVERT(nvarchar(max), {Arg(0)}))";
            case "TRIM":
                int[] whitespace = [9, 10, 11, 12, 13, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279];
                var trimmed = $"TRANSLATE(COALESCE(CONVERT(nvarchar(max), {Arg(0)}), ''), CONCAT({string.Join(", ", whitespace.Select(code => $"NCHAR({code})"))}), REPLICATE(' ', {whitespace.Length}))";
                for (var index = 0; index < 31; index++) trimmed = $"REPLACE({trimmed}, '  ', ' ')";
                return $"TRIM({trimmed})";
            case "CONCATENATE": return $"CONCAT('', {string.Join(", ", values)})";
            case "SUBSTITUTE": return $"REPLACE(CONVERT(nvarchar(max), {Arg(0)}), {Arg(1)}, {Arg(2)})";
            case "FIND":
            case "SEARCH":
                var needle = $"CONVERT(nvarchar(max), {Arg(0)})";
                var haystack = $"CONVERT(nvarchar(max), {Arg(1)})";
                if (name == "SEARCH") { needle = $"LOWER({needle})"; haystack = $"LOWER({haystack})"; }
                var position = $"CHARINDEX({needle} COLLATE Latin1_General_100_BIN2, {haystack} COLLATE Latin1_General_100_BIN2, CONVERT(int, {Numeric(2, "1")}))";
                return $"COALESCE(NULLIF({position}, 0), {Arg(3)})";
            case "VALUE": return Number($"REPLACE(CONVERT(nvarchar(max), {Arg(0)}), ',', '')");
            case "EXACT": return $"CASE WHEN CONVERT(nvarchar(max), {Arg(0)}) COLLATE Latin1_General_100_BIN2 = CONVERT(nvarchar(max), {Arg(1)}) COLLATE Latin1_General_100_BIN2 THEN 1 ELSE 0 END";
            case "TODAY": return "CONVERT(date, GETDATE())";
            case "NOW": return "GETDATE()";
            case "DATE": return $"DATEFROMPARTS(CONVERT(int, {Numeric(0)}), CONVERT(int, {Numeric(1)}), CONVERT(int, {Numeric(2)}))";
            case "DATEVALUE": return Date(0);
            case "YEAR": return $"YEAR({Date(0)})";
            case "MONTH": return $"MONTH({Date(0)})";
            case "DAY": return $"DAY({Date(0)})";
            case "QUARTER": return $"DATEPART(quarter, {Date(0)})";
            case "EOMONTH": return $"EOMONTH({Date(0)}, CONVERT(int, {Numeric(1)}))";
            case "WEEKDAY":
                var weekday = $"((DATEDIFF(day, CONVERT(date, '19000101'), {Date(0)}) % 7 + 7) % 7)";
                return $"CASE WHEN {Numeric(1, "1")} = 2 THEN {weekday} + 1 ELSE ({weekday} + 1) % 7 + 1 END";
            case "DATEDIFF":
                var unit = args[2].GetProperty("value").GetString()?.ToUpperInvariant();
                if (unit is not ("SECOND" or "MINUTE" or "HOUR" or "DAY" or "WEEK" or "MONTH" or "QUARTER" or "YEAR"))
                    throw new ArgumentException("Invalid DAX date interval.");
                if (unit is "MONTH" or "YEAR") return $"DATEDIFF_BIG({unit}, {Date(0)}, {Date(1)})";
                if (unit == "QUARTER") return $"ROUND(DATEDIFF_BIG(month, {Date(0)}, {Date(1)}) / 3.0, 0, 1)";
                var milliseconds = $"DATEDIFF_BIG(millisecond, {Date(0)}, {Date(1)})";
                if (unit == "DAY") return $"FLOOR({milliseconds} / 86400000.0 + 0.5)";
                var divisor = unit switch { "SECOND" => 1000, "MINUTE" => 60000, "HOUR" => 3600000, _ => 604800000 };
                return $"ROUND({milliseconds} / {divisor}.0, 0, 1)";
            default: throw new ArgumentException("Unsupported DAX function.");
        }
    }

    private string Aggregate(string name, JsonElement[] args, bool row, int depth)
    {
        if (name == "COUNT" && args.Length == 0) return row ? "1" : "(SELECT COUNT_BIG(*) FROM [_tile_dax_source])";
        var percentile = name is "MEDIAN" or "PERCENTILE" or "PERCENTILE.INC";
        var hasFraction = name is "PERCENTILE" or "PERCENTILE.INC";
        Require(args, hasFraction ? 2 : 1, 32);
        var inputs = hasFraction ? args[..^1] : args;
        var projection = string.Join(", ", inputs.Select((argument, index) => $"{Render(argument, true, depth + 1)} AS [arg{index}]"));
        var values = $"OPENJSON((SELECT {projection} FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)) _dax_values";
        var from = row ? values : $"[_tile_dax_source] CROSS APPLY {values}";
        var numeric = name is "COUNTBLANK" or "DISTINCTCOUNTNOBLANK" or "STDEV.S" or "STDEV.P" or "VAR.S" or "VAR.P" or "PERCENTILE.INC"
            ? "TRY_CONVERT(float, CASE WHEN _dax_values.[type] = 3 OR DATALENGTH(_dax_values.[value]) = 0 THEN NULL ELSE _dax_values.[value] END)"
            : "CASE WHEN _dax_values.[value] IS NULL THEN 0.0 WHEN _dax_values.[type] = 3 THEN CASE WHEN _dax_values.[value] = 'true' THEN 1.0 ELSE 0.0 END ELSE TRY_CONVERT(float, _dax_values.[value]) END";
        if (percentile)
        {
            var fraction = 0.5;
            if (hasFraction && (args[^1].GetProperty("kind").GetString() != "literal"
                || !args[^1].GetProperty("value").TryGetDouble(out fraction) || !double.IsFinite(fraction) || fraction < 0 || fraction > 1))
                throw new ArgumentException("DAX percentile must be a literal between 0 and 1.");
            return $"COALESCE((SELECT TOP 1 PERCENTILE_CONT({fraction.ToString(CultureInfo.InvariantCulture)}) WITHIN GROUP (ORDER BY {numeric}) OVER () FROM {from}), 0)";
        }
        var aggregate = name switch
        {
            "SUM" => $"SUM({numeric})",
            "AVERAGE" => $"AVG({numeric})",
            "MIN" => $"MIN({numeric})",
            "MAX" => $"MAX({numeric})",
            "COUNT" => "COUNT_BIG(CASE WHEN DATALENGTH(_dax_values.[value]) > 0 THEN 1 END)",
            "DISTINCTCOUNT" => "COUNT_BIG(DISTINCT CASE WHEN DATALENGTH(_dax_values.[value]) > 0 THEN _dax_values.[value] + '#' COLLATE Latin1_General_100_BIN2 END)",
            "DISTINCTCOUNTNOBLANK" => "COUNT_BIG(DISTINCT (LOWER(_dax_values.[value]) + '#') COLLATE Latin1_General_100_BIN2)",
            "COUNTBLANK" => "SUM(CASE WHEN _dax_values.[value] IS NULL OR DATALENGTH(_dax_values.[value]) = 0 THEN 1.0 ELSE 0.0 END)",
            "STDEV" or "STDEV.S" => $"STDEV({numeric})",
            "STDEV.P" => $"STDEVP({numeric})",
            "VARIANCE" or "VAR.S" => $"VAR({numeric})",
            "VAR.P" => $"VARP({numeric})",
            "PRODUCT" => $"CASE WHEN COUNT_BIG(*) = 0 OR MIN(ABS({numeric})) = 0 THEN 0.0 ELSE POWER(-1.0, SUM(CASE WHEN {numeric} < 0 THEN 1 ELSE 0 END)) * EXP(SUM(LOG(NULLIF(ABS({numeric}), 0)))) END",
            _ => throw new ArgumentException("Invalid DAX aggregate."),
        };
        return $"COALESCE((SELECT {aggregate} FROM {from}), 0)";
    }

    private static string Number(string value) => $"COALESCE(TRY_CONVERT(float, {value}), 0.0)";

    private static void Require(JsonElement[] arguments, int minimum, int maximum)
    {
        if (arguments.Length < minimum || arguments.Length > maximum) throw new ArgumentException("Invalid DAX argument count.");
    }
}