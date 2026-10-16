using System.Globalization;
using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class MeasureTextTests
{
    private static AggregateNode Agg(string fn, string source, string column, MeasureCondition? where = null)
        => new(fn, new ColumnNode(source, column), where);

    private static MeasureCondition When(string source, string column, string op, string value)
        => new(new ColumnNode(source, column), op, value);

    private static BinaryNode Bin(string op, MeasureNode left, MeasureNode right) => new(op, left, right);

    // The same trees and texts are pinned in measure-syntax.util.spec.ts, so the browser and the server print alike.
    public static TheoryData<MeasureNode, string> Canonical => new()
    {
        { Agg("count", "TaskDaily", "task_daily_id"), "COUNT(TaskDaily.task_daily_id)" },
        {
            Bin("/", Agg("sum", "TaskDaily", "data_hours"), Agg("count", "TaskDaily", "task_daily_id")),
            "SUM(TaskDaily.data_hours) / COUNT(TaskDaily.task_daily_id)"
        },
        { Bin("*", Bin("+", Agg("sum", "t", "x"), Agg("sum", "t", "y")), new NumberNode(2)), "(SUM(t.x) + SUM(t.y)) * 2" },
        { Bin("-", Agg("sum", "t", "x"), Bin("-", Agg("sum", "t", "y"), new NumberNode(1))), "SUM(t.x) - (SUM(t.y) - 1)" },
        { Bin("+", Bin("*", Agg("sum", "t", "x"), new NumberNode(2)), new NumberNode(0.25m)), "SUM(t.x) * 2 + 0.25" },
        { Bin("-", Agg("avg", "t", "x"), new NumberNode(-1.5m)), "AVG(t.x) - -1.5" },
        {
            Agg("count_distinct", "CrewType", "code", When("CrewType", "code", "neq", "Night's")),
            "DISTINCTCOUNT(CrewType.code WHERE CrewType.code <> 'Night''s')"
        },
        { Agg("max", "t", "Hours Worked", When("t", "a]b", "gte", "3")), "MAX(t.[Hours Worked] WHERE t.[a]]b] >= 3)" },
        {
            Agg("min", "TaskDaily", "action_on", When("TaskDaily", "action_on", "gt", "2026-01-31")),
            "MIN(TaskDaily.action_on WHERE TaskDaily.action_on > '2026-01-31')"
        },
    };

    [Theory]
    [MemberData(nameof(Canonical))]
    public void Prints_the_canonical_text(MeasureNode node, string text) => MeasureText.Print(node).Should().Be(text);

    private static ColumnNode Col(string source, string column) => new(source, column);

    private static FunctionNode Call(string fn, params MeasureNode[] args) => new(fn, args);

    // The same trees and texts are pinned in measure-syntax.util.spec.ts (ROW_CANONICAL).
    public static TheoryData<MeasureNode, string> RowCanonical => new()
    {
        { Bin("*", Col("TaskDaily", "data_hours"), new NumberNode(60)), "TaskDaily.data_hours * 60" },
        { Call("year", Col("TaskDaily", "action_on")), "YEAR(TaskDaily.action_on)" },
        { Call("left", Col("TaskDaily", "task_code"), new NumberNode(4)), "LEFT(TaskDaily.task_code, 4)" },
        { Call("concat", Col("t", "first_name"), new TextNode(" "), Col("t", "last_name")), "CONCAT(t.first_name, ' ', t.last_name)" },
        { Bin("/", Bin("+", Col("t", "a"), Col("t", "b")), new NumberNode(2)), "(t.a + t.b) / 2" },
        { Call("upper", Call("trim", Col("t", "Crew Name"))), "UPPER(TRIM(t.[Crew Name]))" },
        { Call("concat", new TextNode("It's "), Col("t", "x"), new TextNode("3")), "CONCAT('It''s ', t.x, '3')" },
        { Bin("-", Col("t", "x"), Bin("*", new NumberNode(-1.5m), Call("month", Col("t", "d")))), "t.x - -1.5 * MONTH(t.d)" },
    };

    [Theory]
    [MemberData(nameof(RowCanonical))]
    public void Prints_the_canonical_text_of_row_formulas(MeasureNode node, string text) => MeasureText.Print(node).Should().Be(text);

    private static CompareNode Cmp(string op, MeasureNode left, MeasureNode right) => new(op, left, right);

    private static TextNode Txt(string value) => new(value);

    private static NumberNode Num(decimal value) => new(value);

    // The same trees and texts are pinned in measure-syntax.util.spec.ts (LIBRARY_CANONICAL).
    public static TheoryData<MeasureNode, string> LibraryCanonical => new()
    {
        { Call("if", Cmp("gt", Col("t", "x"), Num(3)), Txt("High"), Txt("Low")), "IF(t.x > 3, 'High', 'Low')" },
        {
            Call("and", Cmp("gte", Col("t", "a"), Num(1)), Call("not", Call("isblank", Col("t", "b"))),
                Call("or", Cmp("eq", Col("t", "c"), Txt("A")), Cmp("neq", Col("t", "c"), Txt("B")))),
            "AND(t.a >= 1, NOT(ISBLANK(t.b)), OR(t.c = 'A', t.c <> 'B'))"
        },
        { Call("coalesce", Col("t", "nick"), Col("t", "name"), Txt("")), "COALESCE(t.nick, t.name, '')" },
        { Call("isnull", Col("t", "x"), Num(0)), "ISNULL(t.x, 0)" },
        { Call("iferror", Bin("/", Col("t", "a"), Col("t", "b")), Num(0)), "IFERROR(t.a / t.b, 0)" },
        { Call("if", Call("contains", Col("t", "code"), Txt("A-")), Num(1), Num(0)), "IF(CONTAINS(t.code, 'A-'), 1, 0)" },
        { Call("starts_with", Col("t", "code"), Txt("X")), "STARTS_WITH(t.code, 'X')" },
        { Call("ends_with", Col("t", "code"), Txt("_1")), "ENDS_WITH(t.code, '_1')" },
        { Bin("-", Call("len", Col("t", "code")), Num(1)), "LEN(t.code) - 1" },
        { Call("replace", Col("t", "phone"), Txt("-"), Txt("")), "REPLACE(t.phone, '-', '')" },
        { Call("substring", Col("t", "code"), Num(2), Num(3)), "SUBSTRING(t.code, 2, 3)" },
        { Call("substring", Col("t", "code"), Num(2)), "SUBSTRING(t.code, 2)" },
        { Call("split", Col("t", "name"), Txt(" "), Num(2)), "SPLIT(t.name, ' ', 2)" },
        { Call("split", Col("t", "name"), Txt(", "), Num(-1)), "SPLIT(t.name, ', ', -1)" },
        { Call("first_word", Col("t", "name")), "FIRST_WORD(t.name)" },
        { Call("last_word", Col("t", "name")), "LAST_WORD(t.name)" },
        { Bin("*", Call("to_number", Col("t", "amount")), Num(2)), "TO_NUMBER(t.amount) * 2" },
        { Call("to_date", Col("t", "written"), Txt("dmy")), "TO_DATE(t.written, 'dmy')" },
        {
            Bin("+", Bin("+", Call("day", Col("t", "d")), Call("quarter", Col("t", "d"))), Call("weekday", Col("t", "d"))),
            "DAY(t.d) + QUARTER(t.d) + WEEKDAY(t.d)"
        },
        { Call("concat", Call("month_name", Col("t", "d")), Txt(" "), Call("weekday_name", Col("t", "d"))), "CONCAT(MONTH_NAME(t.d), ' ', WEEKDAY_NAME(t.d))" },
        { Call("month_start", Col("t", "d")), "MONTH_START(t.d)" },
        { Call("datediff", Col("t", "done"), Col("t", "start"), Txt("hours")), "DATEDIFF(t.done, t.start, 'hours')" },
        { Call("datediff", Call("today"), Col("t", "due")), "DATEDIFF(TODAY(), t.due)" },
        { Call("round", Bin("*", Col("t", "x"), Num(1.5m)), Num(2)), "ROUND(t.x * 1.5, 2)" },
        { Call("abs", Bin("-", Col("t", "a"), Col("t", "b"))), "ABS(t.a - t.b)" },
        { Bin("*", Call("floor", Bin("/", Col("t", "x"), Num(10))), Num(10)), "FLOOR(t.x / 10) * 10" },
        { Call("ceiling", Col("t", "x")), "CEILING(t.x)" },
        { Call("min_of", Col("t", "cost"), Col("t", "budget")), "MIN_OF(t.cost, t.budget)" },
        { Call("max_of", Col("t", "a"), Col("t", "b"), Num(0)), "MAX_OF(t.a, t.b, 0)" },
        { Bin("*", Cmp("gt", Col("t", "a"), Num(1)), Num(2)), "(t.a > 1) * 2" },
        { Cmp("eq", Cmp("gt", Col("t", "a"), Num(1)), Cmp("gt", Col("t", "b"), Num(1))), "(t.a > 1) = (t.b > 1)" },
        { Cmp("gte", Bin("+", Col("t", "a"), Num(1)), Bin("*", Col("t", "b"), Num(2))), "t.a + 1 >= t.b * 2" },
        {
            Call("if", Cmp("eq", Col("t", "x"), Num(1)), Col("t", "y"), Call("if", Cmp("eq", Col("t", "x"), Num(2)), Col("t", "z"), Num(0))),
            "IF(t.x = 1, t.y, IF(t.x = 2, t.z, 0))"
        },
        { Cmp("lt", Col("t", "d"), Txt("2026-01-31")), "t.d < '2026-01-31'" },
    };

    [Theory]
    [MemberData(nameof(LibraryCanonical))]
    public void Prints_the_canonical_text_of_the_function_library(MeasureNode node, string text) => MeasureText.Print(node).Should().Be(text);

    private static FunctionNode Across(string fn, MeasureNode arg) => new(fn, [arg]);

    private static AggregateNode Rows(string source, MeasureCondition? where = null) => new("count_rows", new ColumnNode(source, "*"), where);

    // The same trees and texts are pinned in measure-syntax.util.spec.ts (MEASURE_LIBRARY_CANONICAL).
    public static TheoryData<MeasureNode, string> MeasureLibraryCanonical => new()
    {
        { Rows("TaskDaily"), "COUNTROWS(TaskDaily)" },
        { Rows("TaskDaily", When("TaskDaily", "data_hours", "gt", "0")), "COUNTROWS(TaskDaily WHERE TaskDaily.data_hours > 0)" },
        { Rows("My Table"), "COUNTROWS([My Table])" },
        { Across("percent_of_total", Agg("sum", "t", "x")), "PERCENT_OF_TOTAL(SUM(t.x))" },
        { Across("running_total", Bin("/", Agg("sum", "t", "x"), Agg("count", "t", "id"))), "RUNNING_TOTAL(SUM(t.x) / COUNT(t.id))" },
        { Across("change", Agg("sum", "t", "x")), "CHANGE(SUM(t.x))" },
        { Across("change_pct", Rows("t")), "CHANGE_PCT(COUNTROWS(t))" },
        { Bin("-", Agg("sum", "t", "x"), Across("change", Agg("sum", "t", "x"))), "SUM(t.x) - CHANGE(SUM(t.x))" },
    };

    [Theory]
    [MemberData(nameof(MeasureLibraryCanonical))]
    public void Prints_the_canonical_text_of_measure_functions(MeasureNode node, string text) => MeasureText.Print(node).Should().Be(text);

    [Theory]
    [InlineData("8.0", "8")]
    [InlineData("0.000001", "0.000001")]
    [InlineData("-0.50", "-0.5")]
    [InlineData("1000", "1000")]
    public void Numbers_print_as_the_browser_prints_them(string value, string text)
        => MeasureText.Print(Bin("*", Agg("sum", "t", "x"), new NumberNode(decimal.Parse(value, CultureInfo.InvariantCulture))))
            .Should().Be($"SUM(t.x) * {text}");

    [Fact]
    public void Function_and_comparison_codes_in_any_case_print_the_same()
        => MeasureText.Print(Agg("SUM", "t", "x", When("t", "y", "EQ", "1"))).Should().Be("SUM(t.x WHERE t.y = 1)");

    [Fact]
    public void A_name_ending_in_a_line_break_is_bracketed()
        => MeasureText.Print(Agg("count", "t", "x\n")).Should().Be("COUNT(t.[x\n])");

    [Fact]
    public void A_negative_number_on_the_left_prints_without_brackets()
        => MeasureText.Print(Bin("*", new NumberNode(-2), Agg("sum", "t", "x"))).Should().Be("-2 * SUM(t.x)");

    [Fact]
    public void Names_holding_a_dot_or_an_opening_bracket_are_bracketed()
        => MeasureText.Print(Agg("sum", "a.b", "[x", When("a.b", "y[1]", "eq", "1"))).Should().Be("SUM([a.b].[[x] WHERE [a.b].[y[1]]] = 1)");

    // The parser reads a name after "(" or "WHERE" as a column, so keywords and function names print bare.
    [Fact]
    public void Keywords_and_function_names_used_as_names_print_bare()
        => MeasureText.Print(Agg("sum", "WHERE", "SUM", When("WHERE", "SUM", "eq", "x"))).Should().Be("SUM(WHERE.SUM WHERE WHERE.SUM = 'x')");

    // A quoted value is read up to its closing quote, line breaks included, so the break is printed as it is.
    [Theory]
    [InlineData("a\nb", "'a\nb'")]
    [InlineData("3\n", "'3\n'")]
    [InlineData("a\r\nb", "'a\r\nb'")]
    public void A_text_value_with_a_line_break_prints_the_break_inside_its_quotes(string value, string text)
        => MeasureText.Print(Agg("count", "t", "x", When("t", "y", "eq", value))).Should().Be($"COUNT(t.x WHERE t.y = {text})");

    [Fact]
    public void A_bare_column_prints_as_table_dot_column()
        => MeasureText.Print(new ColumnNode("t", "Hours Worked")).Should().Be("t.[Hours Worked]");

    [Fact]
    public void An_unknown_row_function_cannot_be_printed()
        => FluentActions.Invoking(() => MeasureText.Print(Call("sqrt", Col("t", "x")))).Should().Throw<ArgumentException>();
}
