using TWise.Tenant.Application.Features.Model.Query;
using static TWise.Tenant.UnitTests.Features.Model.QueryCompilerTests;

namespace TWise.Tenant.UnitTests.Features.Model;

/// <summary>
/// Golden SQL and refusals for the function library: the logic, text, date and number functions of calculated
/// columns, and the measure functions that read the grouped rows.
/// </summary>
public sealed class FunctionLibraryCompilerTests
{
    private static readonly SchemaCatalog Typed = new([
        ("core", "Well", "WellId", "int"), ("core", "Well", "WellName", "nvarchar"),
        ("core", "Well", "PlantCode", "int"), ("core", "Well", "Capacity", "decimal"),
        ("core", "WellDaily", "WellId", "int"), ("core", "WellDaily", "ReportDate", "date"),
        ("core", "WellDaily", "OilBbl", "decimal"), ("core", "WellDaily", "WaterBbl", "decimal"),
        ("core", "WellDaily", "Shift", "varchar"), ("core", "WellDaily", "Reading", "nvarchar"),
        ("core", "WellDaily", "ClosedOn", "datetime2"),
    ]);

    private static ColumnNode Col(string column) => new("d", column);

    private static FunctionNode Call(string fn, params MeasureNode[] args) => new(fn, args);

    private static CompareNode Cmp(string op, MeasureNode left, MeasureNode right) => new(op, left, right);

    private static TextNode Txt(string value) => new(value);

    private static NumberNode Num(decimal value) => new(value);

    // d.C holds the formula. The query groups by it alone, so its source's CTE selects only C.
    private static CompiledQuery Column(MeasureNode formula)
        => QueryCompiler.Compile(
            new DatasetModel([Well, Daily], [DailyToWell], [TotalOil], [new ModelCalculatedColumn(2, "C", formula)], []),
            new QueryRequest(1, ["d.C"], []), Admin, Typed);

    private static void Renders(MeasureNode formula, string sql)
        => Column(formula).Sql.Should().StartWith($"WITH [d] AS (SELECT {sql} AS [C] FROM [core].[WellDaily])");

    private static void Refused(MeasureNode formula, string message, string code = QueryErrors.InvalidColumn)
        => FluentActions.Invoking(() => Column(formula)).Should().Throw<QueryException>()
            .Where(e => e.Code == code && e.Message == message);

    // ── Logic ──────────────────────────────────────────────────────────────────

    public static TheoryData<MeasureNode, string> LogicFunctions => new()
    {
        { Call("if", Cmp("gt", Col("OilBbl"), Num(100)), Txt("High"), Txt("Low")), "CASE WHEN [OilBbl] > 100 THEN @p0 ELSE @p1 END" },
        { Cmp("gte", Col("OilBbl"), Col("WaterBbl")), "CASE WHEN [OilBbl] >= [WaterBbl] THEN 1 ELSE 0 END" },
        {
            Call("and", Cmp("gt", Col("OilBbl"), Num(0)), Call("not", Call("isblank", Col("Shift")))),
            "CASE WHEN ([OilBbl] > 0 AND (CASE WHEN ([Shift] IS NULL OR [Shift] = N'') THEN 1 ELSE 0 END = 0)) THEN 1 ELSE 0 END"
        },
        { Call("isblank", Col("OilBbl")), "CASE WHEN [OilBbl] IS NULL THEN 1 ELSE 0 END" },
        { Call("coalesce", Col("Shift"), Txt("Day")), "COALESCE([Shift], @p0)" },
        { Call("isnull", Col("OilBbl"), Num(0)), "COALESCE([OilBbl], 0)" },
        { Call("iferror", new BinaryNode("/", Col("OilBbl"), Col("WaterBbl")), Num(0)), "COALESCE((1.0 * [OilBbl] / NULLIF([WaterBbl], 0)), 0)" },
        { Call("if", Col("OilBbl"), Num(1), Num(0)), "CASE WHEN [OilBbl] <> 0 THEN 1 ELSE 0 END" },
        { Call("starts_with", Col("Shift"), Txt("N")), @"CASE WHEN [Shift] LIKE @p0 ESCAPE N'\' THEN 1 ELSE 0 END" },
        { Call("if", Cmp("eq", Col("Shift"), Txt("Night")), Col("OilBbl"), Col("WaterBbl")), "CASE WHEN [Shift] = @p0 THEN [OilBbl] ELSE [WaterBbl] END" },
    };

    // A blank value makes a comparison unknown, and NOT of unknown is unknown too: NOT must read it as false first.
    [Fact]
    public void Not_reads_a_blank_condition_as_false()
        => Renders(Call("not", Cmp("gt", Col("OilBbl"), Num(0))), "CASE WHEN (CASE WHEN [OilBbl] > 0 THEN 1 ELSE 0 END = 0) THEN 1 ELSE 0 END");

    [Theory]
    [MemberData(nameof(LogicFunctions))]
    public void Logic_functions_render_inside_the_cte(MeasureNode formula, string sql) => Renders(formula, sql);

    [Fact]
    public void Text_compared_with_a_date_becomes_a_date_parameter()
    {
        var result = Column(Call("or", Cmp("eq", Col("Shift"), Txt("Night")), Cmp("lt", Col("ReportDate"), Txt("2026-01-01"))));

        result.Sql.Should().StartWith(
            "WITH [d] AS (SELECT CASE WHEN ([Shift] = @p0 OR [ReportDate] < @p1) THEN 1 ELSE 0 END AS [C] FROM [core].[WellDaily])");
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = "Night", ["@p1"] = new DateTime(2026, 1, 1), ["@top"] = QueryCompiler.DefaultTopN,
        });
    }

    [Fact]
    public void Text_tests_escape_the_wildcards_of_their_value()
    {
        var result = Column(Call("contains", Col("Shift"), Txt(@"50%_[x]\")));

        result.Sql.Should().StartWith(@"WITH [d] AS (SELECT CASE WHEN [Shift] LIKE @p0 ESCAPE N'\' THEN 1 ELSE 0 END AS [C] FROM [core].[WellDaily])");
        result.Parameters["@p0"].Should().Be(@"%50\%\_\[x]\\%");
        Column(Call("ends_with", Col("Shift"), Txt("1"))).Parameters["@p0"].Should().Be("%1");
    }

    public static TheoryData<MeasureNode, string> LogicRefusals => new()
    {
        { Call("if", Cmp("gt", Col("OilBbl"), Num(0)), Txt("Wet"), Num(0)), "IF in d.C mixes 'Wet', which holds text, with 0, which holds numbers." },
        { Cmp("gt", Col("Shift"), Col("OilBbl")), "d.C compares d.Shift, which holds text, with d.OilBbl, which holds numbers." },
        { Cmp("gt", Col("ReportDate"), Txt("soon")), "d.C compares d.ReportDate, which holds dates, with 'soon'. Use a date written as 2026-01-31." },
        { Call("if", Col("Shift"), Num(1), Num(0)), "IF in d.C needs a condition, such as d.column > 3, but d.Shift holds text." },
        {
            Call("contains", Col("Shift"), Col("Reading")),
            "CONTAINS in d.C needs text in single quotes as its second part, for example CONTAINS(d.column, 'A')."
        },
        { Call("and", Cmp("gt", Col("OilBbl"), Num(0))), "AND in d.C takes 2 to 10 parts." },
    };

    [Theory]
    [MemberData(nameof(LogicRefusals))]
    public void Logic_functions_refuse_what_they_cannot_read(MeasureNode formula, string message) => Refused(formula, message);

    // ── Text ───────────────────────────────────────────────────────────────────

    public static TheoryData<MeasureNode, string> TextFunctions => new()
    {
        { Call("len", Col("Shift")), "LEN([Shift])" },
        { Call("replace", Col("Shift"), Txt("-"), Txt("")), "REPLACE([Shift], @p0, @p1)" },
        { Call("substring", Col("Shift"), Num(2), Num(3)), "SUBSTRING([Shift], 2, 3)" },
        { Call("substring", Col("Shift"), Num(2)), "SUBSTRING([Shift], 2, 2147483647)" },
        {
            Call("split", Col("Shift"), Txt("-"), Num(1)),
            "LEFT((CAST([Shift] AS nvarchar(max)) + @p0), NULLIF(CHARINDEX(@p0, (CAST([Shift] AS nvarchar(max)) + @p0)), 0) - 1)"
        },
        {
            Call("split", Col("Shift"), Txt("-"), Num(2)),
            "LEFT(SUBSTRING((CAST([Shift] AS nvarchar(max)) + @p0), NULLIF(CHARINDEX(@p0, (CAST([Shift] AS nvarchar(max)) + @p0)), 0) + 1, 2147483647), " +
            "NULLIF(CHARINDEX(@p0, SUBSTRING((CAST([Shift] AS nvarchar(max)) + @p0), NULLIF(CHARINDEX(@p0, (CAST([Shift] AS nvarchar(max)) + @p0)), 0) + 1, 2147483647)), 0) - 1)"
        },
        {
            Call("split", Col("Shift"), Txt(", "), Num(-1)),
            "COALESCE(RIGHT([Shift], NULLIF(CHARINDEX(REVERSE(@p0), REVERSE([Shift])), 0) - 1), [Shift])"
        },
        {
            Call("first_word", Col("Reading")),
            "LEFT((CAST(LTRIM(RTRIM([Reading])) AS nvarchar(max)) + @p0), NULLIF(CHARINDEX(@p0, (CAST(LTRIM(RTRIM([Reading])) AS nvarchar(max)) + @p0)), 0) - 1)"
        },
        {
            Call("last_word", Col("Reading")),
            "COALESCE(RIGHT(LTRIM(RTRIM([Reading])), NULLIF(CHARINDEX(REVERSE(@p0), REVERSE(LTRIM(RTRIM([Reading])))), 0) - 1), LTRIM(RTRIM([Reading])))"
        },
        {
            Call("to_number", Col("Reading")),
            "TRY_CONVERT(decimal(38, 6), REPLACE(REPLACE(REPLACE(REPLACE([Reading], N',', N''), N'$', N''), N'%', N''), N' ', N''))"
        },
        { Call("to_date", Col("Reading"), Txt("dmy")), "TRY_CONVERT(date, [Reading], 103)" },
        { Call("to_date", Col("Reading")), "TRY_CONVERT(date, [Reading], 23)" },
    };

    [Theory]
    [MemberData(nameof(TextFunctions))]
    public void Text_functions_render_inside_the_cte(MeasureNode formula, string sql) => Renders(formula, sql);

    [Fact]
    public void A_split_separator_is_a_parameter()
        => Column(Call("split", Col("Shift"), Txt(", "), Num(-1))).Parameters["@p0"].Should().Be(", ");

    private const string TooLarge = " is too large to calculate. Use fewer functions inside each other, or fewer calculated columns built on each other.";

    [Fact]
    public void Split_inside_split_is_refused_before_it_grows_too_large()
    {
        MeasureNode formula = Col("Shift");
        for (var i = 0; i < 7; i++) formula = Call("split", formula, Txt("-"), Num(4));
        var clock = System.Diagnostics.Stopwatch.StartNew();

        Refused(formula, "d.C" + TooLarge, QueryErrors.FormulaTooLarge);
        clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(2));
    }

    [Fact]
    public void A_chain_of_calculated_columns_that_grows_too_large_is_refused()
    {
        ModelCalculatedColumn Piece(string name, string of) => new(2, name, Call("split", Col(of), Txt("-"), Num(4)));
        var model = new DatasetModel([Well, Daily], [DailyToWell], [TotalOil], [Piece("C1", "Shift"), Piece("C2", "C1"), Piece("C3", "C2")], []);

        QueryCompiler.Compile(model, new QueryRequest(1, ["d.C2"], []), Admin, Typed).Sql.Length.Should().BeLessThan(100_000);
        FluentActions.Invoking(() => QueryCompiler.Compile(model, new QueryRequest(1, ["d.C3"], []), Admin, Typed))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.FormulaTooLarge && e.Message == "d.C3" + TooLarge);
    }

    public static TheoryData<MeasureNode, string> TextRefusals => new()
    {
        { Call("split", Col("Shift"), Txt("-"), Num(5)), "SPLIT in d.C needs 1, 2, 3, 4 or -1 (the last piece) as its third part." },
        {
            Call("split", Col("Shift"), Col("Reading"), Num(1)),
            "SPLIT in d.C needs the separator as text in single quotes, such as ' ', as its second part."
        },
        { Call("substring", Col("Shift"), Num(0)), "SUBSTRING in d.C needs a whole number from 1 to 4000 as its second part." },
        { Call("to_date", Col("Reading"), Txt("ymd")), "TO_DATE in d.C needs 'iso', 'dmy' or 'mdy' as its second part." },
        { Call("to_number", Col("OilBbl")), "TO_NUMBER in d.C needs text, but d.OilBbl holds numbers." },
        { Call("len", Col("ReportDate")), "LEN in d.C needs text or numbers, but d.ReportDate holds dates." },
    };

    [Theory]
    [MemberData(nameof(TextRefusals))]
    public void Text_functions_refuse_what_they_cannot_read(MeasureNode formula, string message) => Refused(formula, message);

    // ── Dates and numbers ──────────────────────────────────────────────────────

    public static TheoryData<MeasureNode, string> DateAndNumberFunctions => new()
    {
        { Call("day", Col("ReportDate")), "DAY([ReportDate])" },
        { Call("quarter", Col("ReportDate")), "DATEPART(quarter, [ReportDate])" },
        { Call("weekday", Col("ReportDate")), "((DATEPART(weekday, [ReportDate]) + @@DATEFIRST - 2) % 7 + 1)" },
        {
            Call("month_name", Col("ReportDate")),
            "CHOOSE(MONTH([ReportDate]), N'January', N'February', N'March', N'April', N'May', N'June', N'July', N'August', " +
            "N'September', N'October', N'November', N'December')"
        },
        {
            Call("weekday_name", Col("ReportDate")),
            "CHOOSE(((DATEPART(weekday, [ReportDate]) + @@DATEFIRST - 2) % 7 + 1), N'Monday', N'Tuesday', N'Wednesday', N'Thursday', " +
            "N'Friday', N'Saturday', N'Sunday')"
        },
        { Call("month_start", Col("ReportDate")), "DATEFROMPARTS(YEAR([ReportDate]), MONTH([ReportDate]), 1)" },
        { Call("datediff", Col("ClosedOn"), Col("ReportDate")), "DATEDIFF(day, [ReportDate], [ClosedOn])" },
        { Call("datediff", Col("ClosedOn"), Col("ReportDate"), Txt("Hours")), "DATEDIFF(hour, [ReportDate], [ClosedOn])" },
        { Call("datediff", Col("ClosedOn"), Col("ReportDate"), Txt("weeks")), "ROUND(DATEDIFF(day, [ReportDate], [ClosedOn]) / 7.0, 1)" },
        {
            Call("datediff", Col("ClosedOn"), Col("ReportDate"), Txt("months")),
            "(DATEDIFF(month, [ReportDate], [ClosedOn]) - CASE WHEN [ClosedOn] >= [ReportDate] AND DAY([ClosedOn]) < DAY([ReportDate]) THEN 1 " +
            "WHEN [ClosedOn] < [ReportDate] AND DAY([ClosedOn]) > DAY([ReportDate]) THEN -1 ELSE 0 END)"
        },
        {
            Call("datediff", Call("today"), Col("ReportDate"), Txt("years")),
            "(DATEDIFF(year, [ReportDate], CAST(GETDATE() AS date)) - CASE WHEN CAST(GETDATE() AS date) >= [ReportDate] AND " +
            "DATEADD(year, DATEDIFF(year, [ReportDate], CAST(GETDATE() AS date)), [ReportDate]) > CAST(GETDATE() AS date) THEN 1 " +
            "WHEN CAST(GETDATE() AS date) < [ReportDate] AND DATEADD(year, DATEDIFF(year, [ReportDate], CAST(GETDATE() AS date)), [ReportDate]) < " +
            "CAST(GETDATE() AS date) THEN -1 ELSE 0 END)"
        },
        { Call("round", Col("OilBbl"), Num(2)), "ROUND([OilBbl], 2)" },
        { Call("round", Col("OilBbl")), "ROUND([OilBbl], 0)" },
        { Call("round", Col("OilBbl"), Num(-2)), "ROUND([OilBbl], -2)" },
        { Call("abs", new BinaryNode("-", Col("OilBbl"), Col("WaterBbl"))), "ABS((COALESCE([OilBbl], 0) - COALESCE([WaterBbl], 0)))" },
        {
            new BinaryNode("*", Call("floor", new BinaryNode("/", Col("OilBbl"), Num(10))), Num(10)),
            "(FLOOR((1.0 * [OilBbl] / NULLIF(10, 0))) * 10)"
        },
        { Call("ceiling", Col("OilBbl")), "CEILING([OilBbl])" },
        { Call("min_of", Col("OilBbl"), Col("WaterBbl"), Num(0)), "(SELECT MIN(v) FROM (VALUES ([OilBbl]), ([WaterBbl]), (0)) AS m(v))" },
        { Call("max_of", Col("ReportDate"), Col("ClosedOn")), "(SELECT MAX(v) FROM (VALUES ([ReportDate]), ([ClosedOn])) AS m(v))" },
    };

    [Theory]
    [MemberData(nameof(DateAndNumberFunctions))]
    public void Date_and_number_functions_render_inside_the_cte(MeasureNode formula, string sql) => Renders(formula, sql);

    public static TheoryData<MeasureNode, string> DateAndNumberRefusals => new()
    {
        { Call("day", Col("Shift")), "DAY in d.C needs a date, but d.Shift holds text." },
        {
            Call("datediff", Col("ClosedOn"), Col("ReportDate"), Txt("fortnights")),
            "DATEDIFF in d.C needs 'days', 'hours', 'minutes', 'weeks', 'months' or 'years' as its third part."
        },
        { Call("round", Col("OilBbl"), Num(7)), "ROUND in d.C needs a whole number from -6 to 6 as its second part." },
        { Call("round", Col("Shift")), "ROUND in d.C needs numbers, but d.Shift holds text." },
        { Call("today", Col("OilBbl")), "TODAY in d.C takes 0 parts." },
        { Call("min_of", Col("OilBbl"), Col("Shift")), "MIN_OF in d.C mixes d.OilBbl, which holds numbers, with d.Shift, which holds text." },
    };

    [Theory]
    [MemberData(nameof(DateAndNumberRefusals))]
    public void Date_and_number_functions_refuse_what_they_cannot_read(MeasureNode formula, string message) => Refused(formula, message);

    // ── Measures ───────────────────────────────────────────────────────────────

    private static AggregateNode Sum(string source, string column) => new("sum", new ColumnNode(source, column));

    private static AggregateNode Rows(string source, MeasureCondition? where = null) => new("count_rows", new ColumnNode(source, "*"), where);

    private static ModelMeasure Measure(string name, MeasureNode expression) => new(name, expression);

    private static DatasetModel Measures(ModelTransform[] transforms, params ModelMeasure[] measures)
        => new([Well, Daily], [DailyToWell], [TotalOil, .. measures], [], transforms);

    private static CompiledQuery Query(DatasetModel model, QueryRequest request, UserScope? user = null)
        => QueryCompiler.Compile(model, request, user ?? Admin, Typed);

    private static void RefusedMeasure(MeasureNode expression, string message)
        => FluentActions.Invoking(() => Query(Measures([], Measure("M", expression)), new QueryRequest(1, ["d.ReportDate"], ["M"])))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure && e.Message == message);

    [Fact]
    public void Countrows_counts_every_row_or_the_rows_that_pass_its_condition()
    {
        var model = Measures([],
            Measure("Rows", Rows("d")),
            Measure("Wet Rows", Rows("d", new MeasureCondition(new ColumnNode("d", "WaterBbl"), "gt", "0"))));

        var result = Query(model, new QueryRequest(1, ["d.Shift"], ["Rows", "Wet Rows"]));

        result.Sql.Should().Be("""
            SELECT TOP (@top) [d].[Shift] AS [d.Shift], COUNT(*) AS [Rows], COUNT(CASE WHEN [d].[WaterBbl] > @p0 THEN 1 END) AS [Wet Rows]
            FROM [core].[WellDaily] AS [d]
            GROUP BY [d].[Shift]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@p0"].Should().Be(0m);
    }

    [Fact]
    public void Countrows_alone_on_a_source_read_through_a_cte_selects_a_constant()
        => Query(Measures([new ModelTransform(2, "Shift", "trim")], Measure("Rows", Rows("d"))), new QueryRequest(1, [], ["Rows"]))
            .Sql.Should().Be("""
                WITH [d] AS (SELECT 1 AS [_row] FROM [core].[WellDaily])
                SELECT TOP (@top) COUNT(*) AS [Rows]
                FROM [d]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void Countrows_does_not_hide_a_fan_trap()
        => FluentActions.Invoking(() => Query(Measures([], Measure("Wells", Rows("w"))), new QueryRequest(1, ["d.ReportDate"], ["Wells"])))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.FanTrap && e.Message ==
                "Wells would count each w row once per matching d row. Remove the d fields from this query, or use a measure based on d.");

    // COUNT(*) counts the rows of the table the query starts from: a well with no daily row would count as one.
    [Fact]
    public void Countrows_of_a_table_joined_to_the_one_the_query_starts_from_is_refused()
        => FluentActions.Invoking(() => Query(
                Measures([], Measure("Top Capacity", new AggregateNode("max", new ColumnNode("w", "Capacity"))), Measure("Rows", Rows("d"))),
                new QueryRequest(1, ["w.WellName"], ["Top Capacity", "Rows"])))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.CountRowsJoined && e.Message ==
                "Rows counts the rows of d, but this query reads its rows from w, so a w row with no d row would be counted too. " +
                "Show Rows first, or count a column of d with COUNT instead.");

    [Fact]
    public void Percent_of_total_and_running_total_read_only_the_rows_the_plant_predicate_keeps()
    {
        var model = Measures([new ModelTransform(1, "WellName", "trim")],
            Measure("Share", Call("percent_of_total", Sum("d", "OilBbl"))),
            Measure("Cumulative", Call("running_total", Sum("d", "OilBbl"))));

        var result = Query(model, new QueryRequest(1, ["w.WellName"], ["Share", "Cumulative"]), PlantUser);

        result.Sql.Should().Be("""
            WITH [w] AS (SELECT LTRIM(RTRIM([WellName])) AS [WellName], [WellId], [PlantCode] FROM [core].[Well])
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], (100.0 * SUM([d].[OilBbl]) / NULLIF(SUM(SUM([d].[OilBbl])) OVER (), 0)) AS [Share], SUM(SUM([d].[OilBbl])) OVER (ORDER BY [w].[WellName] ROWS UNBOUNDED PRECEDING) AS [Cumulative]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [w] ON [d].[WellId] = [w].[WellId]
            WHERE [w].[PlantCode] IN (@p0, @p1)
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object> { ["@p0"] = 101, ["@p1"] = 102, ["@top"] = QueryCompiler.DefaultTopN });

        // The windows sit in the SELECT of the statement whose WHERE holds the plant predicate, never in a CTE.
        var lines = result.Sql.Split('\n');
        lines.Where(line => line.Contains(" OVER ")).Should().ContainSingle().Which.Should().StartWith("SELECT TOP (@top) ");
        lines.Single(line => line.StartsWith("WITH ")).Should().NotContain("OVER");
        lines.Should().Contain("WHERE [w].[PlantCode] IN (@p0, @p1)");
    }

    [Fact]
    public void Change_goes_along_the_first_field_and_starts_again_for_each_value_of_the_others()
        => Query(Measures([], Measure("Change", Call("change", Sum("d", "OilBbl")))),
                new QueryRequest(1, ["d.ReportDate", "w.WellName"], ["Change"]), PlantUser)
            .Sql.Should().Be("""
                SELECT TOP (@top) [d].[ReportDate] AS [d.ReportDate], [w].[WellName] AS [w.WellName], (SUM([d].[OilBbl]) - LAG(SUM([d].[OilBbl])) OVER (PARTITION BY [w].[WellName] ORDER BY [d].[ReportDate])) AS [Change]
                FROM [core].[WellDaily] AS [d]
                LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
                WHERE [w].[PlantCode] IN (@p0, @p1)
                GROUP BY [d].[ReportDate], [w].[WellName]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void Change_pct_is_the_change_as_a_percentage_of_the_row_before()
        => Query(Measures([], Measure("Growth", Call("change_pct", Sum("d", "OilBbl")))), new QueryRequest(1, ["d.ReportDate"], ["Growth"]))
            .Sql.Should().Be("""
                SELECT TOP (@top) [d].[ReportDate] AS [d.ReportDate], (100.0 * (SUM([d].[OilBbl]) - LAG(SUM([d].[OilBbl])) OVER (ORDER BY [d].[ReportDate])) / NULLIF(ABS(LAG(SUM([d].[OilBbl])) OVER (ORDER BY [d].[ReportDate])), 0)) AS [Growth]
                FROM [core].[WellDaily] AS [d]
                GROUP BY [d].[ReportDate]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void Rank_orders_the_rows_by_the_calculation_highest_first_within_each_value_of_the_other_fields()
        => Query(Measures([], Measure("Rank", Call("rank", Sum("d", "OilBbl")))), new QueryRequest(1, ["w.WellName", "d.Shift"], ["Rank"]))
            .Sql.Should().Contain("RANK() OVER (PARTITION BY [d].[Shift] ORDER BY SUM([d].[OilBbl]) DESC) AS [Rank]");

    [Fact]
    public void Ytd_adds_up_along_the_date_and_starts_again_each_year()
        => Query(Measures([], Measure("YTD", Call("ytd", Sum("d", "OilBbl")))), new QueryRequest(1, ["d.ReportDate", "d.Shift"], ["YTD"]))
            .Sql.Should().Contain(
                "SUM(SUM([d].[OilBbl])) OVER (PARTITION BY [d].[Shift], YEAR([d].[ReportDate]) ORDER BY [d].[ReportDate] ROWS UNBOUNDED PRECEDING) AS [YTD]");

    [Fact]
    public void Ytd_needs_a_date_first()
        => FluentActions.Invoking(() => Query(Measures([], Measure("YTD", Call("ytd", Sum("d", "OilBbl")))), new QueryRequest(1, ["d.Shift"], ["YTD"])))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure && e.Message ==
                "YTD uses YTD, which adds up along a date. Put a date field first on the visual, such as a day or a month.");

    [Fact]
    public void Without_a_field_ytd_reads_the_one_row()
        => Query(Measures([], Measure("YTD", Call("ytd", Sum("d", "OilBbl")))), new QueryRequest(1, [], ["YTD"]))
            .Sql.Should().Contain("SUM(SUM([d].[OilBbl])) OVER (ORDER BY (SELECT NULL) ROWS UNBOUNDED PRECEDING) AS [YTD]");

    [Fact]
    public void Moving_average_reads_the_row_and_the_rows_before_it()
        => Query(Measures([], Measure("Avg 3", Call("moving_avg", Sum("d", "OilBbl"), Num(3)))), new QueryRequest(1, ["d.ReportDate"], ["Avg 3"]))
            .Sql.Should().Contain("AVG(1.0 * SUM([d].[OilBbl])) OVER (ORDER BY [d].[ReportDate] ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS [Avg 3]");

    [Theory]
    [InlineData(1)]
    [InlineData(2.5)]
    [InlineData(400)]
    public void Moving_average_needs_a_whole_number_of_rows_from_2_to_366(decimal rows)
        => RefusedMeasure(Call("moving_avg", Sum("d", "OilBbl"), Num(rows)),
            $"M averages over {rows} rows. Use a whole number from 2 to 366.");

    [Fact]
    public void Threshold_scores_100_past_green_50_past_amber_and_0_before_and_reverses_when_green_is_lower()
    {
        Query(Measures([], Measure("Score", Call("threshold", Sum("d", "OilBbl"), Num(50), Num(80)))), new QueryRequest(1, ["d.ReportDate"], ["Score"]))
            .Sql.Should().Contain("(CASE WHEN SUM([d].[OilBbl]) IS NULL THEN NULL WHEN SUM([d].[OilBbl]) >= 80 THEN 100 WHEN SUM([d].[OilBbl]) >= 50 THEN 50 ELSE 0 END) AS [Score]");
        Query(Measures([], Measure("Score", Call("threshold", Sum("d", "WaterBbl"), Num(20), Num(5)))), new QueryRequest(1, ["d.ReportDate"], ["Score"]))
            .Sql.Should().Contain("WHEN SUM([d].[WaterBbl]) <= 5 THEN 100 WHEN SUM([d].[WaterBbl]) <= 20 THEN 50 ELSE 0 END");
    }

    [Fact]
    public void Threshold_takes_a_calculation_and_two_numbers()
        => RefusedMeasure(Call("threshold", Sum("d", "OilBbl"), Num(50)),
            "M uses THRESHOLD with 2 parts. It takes a calculation, an amber number and a green number, as in THRESHOLD(SUM(table.column), 50, 80).");

    [Fact]
    public void A_date_hierarchy_level_groups_and_filters_by_that_part_of_the_date()
    {
        var result = Query(Measures([], Measure("Oil", Sum("d", "OilBbl"))), new QueryRequest(1, ["d.ReportDate@quarter"], ["Oil"],
            [new QueryFilter("d.ReportDate@year", "eq", ["2026"]), new QueryFilter("d.ReportDate@month", "eq", ["2026-04-01"])],
            new QuerySort("d.ReportDate@quarter")));

        result.Sql.Should().Contain("SELECT TOP (@top) CONCAT(YEAR([d].[ReportDate]), ' Q', DATEPART(quarter, [d].[ReportDate])) AS [d.ReportDate@quarter]")
            .And.Contain("WHERE YEAR([d].[ReportDate]) = @p0 AND DATEFROMPARTS(YEAR([d].[ReportDate]), MONTH([d].[ReportDate]), 1) = @p1")
            .And.Contain("GROUP BY CONCAT(YEAR([d].[ReportDate]), ' Q', DATEPART(quarter, [d].[ReportDate]))")
            .And.Contain("ORDER BY [d.ReportDate@quarter]");
        result.Parameters["@p0"].Should().Be("2026");
        result.Columns.Should().Equal("d.ReportDate@quarter", "Oil");
    }

    [Fact]
    public void Only_a_date_has_hierarchy_levels()
        => FluentActions.Invoking(() => Query(Measures([], Measure("Oil", Sum("d", "OilBbl"))), new QueryRequest(1, ["d.Shift@year"], ["Oil"])))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField && e.Message == "d.Shift holds no dates, so it has no year level.");

    [Fact]
    public void Without_a_field_a_running_total_reads_the_one_row()
        => Query(Measures([], Measure("Cumulative", Call("running_total", Sum("d", "OilBbl")))), new QueryRequest(1, [], ["Cumulative"]))
            .Sql.Should().Be("""
                SELECT TOP (@top) SUM(SUM([d].[OilBbl])) OVER (ORDER BY (SELECT NULL) ROWS UNBOUNDED PRECEDING) AS [Cumulative]
                FROM [core].[WellDaily] AS [d]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void A_measure_function_reuses_the_parameters_of_the_calculation_it_reads()
    {
        var nightOil = new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "Shift"), "eq", "Night"));

        var result = Query(Measures([], Measure("Night Share", Call("percent_of_total", nightOil))), new QueryRequest(1, ["d.ReportDate"], ["Night Share"]));

        result.Parameters.Keys.Should().BeEquivalentTo(new[] { "@p0", "@top" });
        result.Sql.Split("@p0").Length.Should().Be(3);
    }

    [Fact]
    public void A_measure_function_inside_another_is_refused()
        => RefusedMeasure(Call("running_total", Call("percent_of_total", Sum("d", "OilBbl"))),
            "M uses RUNNING_TOTAL around another function that reads other rows. Use one of them at a time.");

    [Fact]
    public void A_measure_function_takes_one_calculation()
        => RefusedMeasure(Call("running_total", Sum("d", "OilBbl"), Sum("d", "WaterBbl")),
            "M uses RUNNING_TOTAL with 2 parts. It takes one calculation, as in RUNNING_TOTAL(SUM(table.column)).");

    [Fact]
    public void A_calculated_column_that_reads_other_rows_is_refused_with_its_own_code()
    {
        Refused(Call("running_total", Sum("d", "OilBbl")),
            "d.C uses RUNNING_TOTAL, which compares a row with other rows. A calculated column works on one row at a time; use RUNNING_TOTAL in a measure instead.",
            QueryErrors.CrossRowInColumn);
        Refused(Call("if", Cmp("gt", Col("OilBbl"), Num(0)), Call("percent_of_total", Sum("d", "OilBbl")), Num(0)),
            "d.C uses PERCENT_OF_TOTAL, which compares a row with other rows. A calculated column works on one row at a time; use PERCENT_OF_TOTAL in a measure instead.",
            QueryErrors.CrossRowInColumn);
    }

    [Theory]
    [MemberData(nameof(LogicFunctions))]
    [MemberData(nameof(TextFunctions))]
    [MemberData(nameof(DateAndNumberFunctions))]
    public void No_row_function_reads_another_row(MeasureNode formula, string sql)
        => Column(formula).Sql.Should().Contain(sql).And.NotContain(" OVER ").And.NotContain("LAG(");

    // ROLLUP adds subtotal rows to the grouped rows a window reads, so a total would count them twice.
    [Theory]
    [InlineData("percent_of_total")]
    [InlineData("running_total")]
    [InlineData("change")]
    [InlineData("change_pct")]
    public void A_measure_function_is_refused_in_a_query_with_totals(string fn)
        => FluentActions.Invoking(() => Query(Measures([], Measure("M", new BinaryNode("*", Call(fn, Sum("d", "OilBbl")), Num(2)))),
                new QueryRequest(1, ["d.ReportDate"], ["Total Oil", "M"], Totals: true), PlantUser))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidTotals && e.Message ==
                $"M uses {fn.ToUpperInvariant()}, which reads the other rows of the query, so it cannot be shown with totals. Turn totals off or remove M.");
}
