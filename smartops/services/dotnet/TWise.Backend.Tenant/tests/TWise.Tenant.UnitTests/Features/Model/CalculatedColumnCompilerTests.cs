using TWise.Tenant.Application.Features.Model.Query;
using static TWise.Tenant.UnitTests.Features.Model.QueryCompilerTests;

namespace TWise.Tenant.UnitTests.Features.Model;

/// <summary>Golden SQL and guardrails for sources read through a CTE: calculated columns and transforms.</summary>
public sealed class CalculatedColumnCompilerTests
{
    private static readonly SchemaCatalog Typed = new([
        ("core", "Well", "WellId", "int"), ("core", "Well", "WellName", "nvarchar"),
        ("core", "Well", "PlantCode", "int"), ("core", "Well", "Capacity", "decimal"),
        ("core", "WellDaily", "WellId", "int"), ("core", "WellDaily", "ReportDate", "date"),
        ("core", "WellDaily", "OilBbl", "decimal"), ("core", "WellDaily", "WaterBbl", "decimal"),
        ("core", "WellDaily", "Shift", "varchar"),
    ]);

    private static ColumnNode Col(string source, string column) => new(source, column);

    private static FunctionNode Call(string fn, params MeasureNode[] args) => new(fn, args);

    private static ModelCalculatedColumn Calc(long sourceId, string name, MeasureNode? expression) => new(sourceId, name, expression);

    private static DatasetModel With(ModelCalculatedColumn[] calculated, ModelTransform[] transforms, params ModelMeasure[] measures)
        => new([Well, Daily], [DailyToWell], [TotalOil, .. measures], calculated, transforms);

    private static CompiledQuery Run(DatasetModel model, QueryRequest request, UserScope? user = null)
        => QueryCompiler.Compile(model, request, user ?? Admin, Typed);

    private static void Refused(DatasetModel model, QueryRequest request, string code, string message)
        => FluentActions.Invoking(() => Run(model, request)).Should().Throw<QueryException>()
            .Where(e => e.Code == code && e.Message == message);

    [Fact]
    public void Calculated_column_as_a_dimension_is_computed_in_its_sources_cte()
        => Run(With([Calc(2, "OilMinutes", new BinaryNode("*", Col("d", "OilBbl"), new NumberNode(60)))], []),
                new QueryRequest(1, ["d.OilMinutes"], ["Total Oil"]))
            .Sql.Should().Be("""
                WITH [d] AS (SELECT ([OilBbl] * 60) AS [OilMinutes], [OilBbl] FROM [core].[WellDaily])
                SELECT TOP (@top) [d].[OilMinutes] AS [d.OilMinutes], SUM([d].[OilBbl]) AS [Total Oil]
                FROM [d]
                GROUP BY [d].[OilMinutes]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void Measure_over_a_calculated_column_joins_ctes_and_keeps_the_plant_predicate_on_the_stored_column()
    {
        var model = With(
            [
                Calc(2, "Net", new BinaryNode("-", Col("d", "OilBbl"), Col("d", "WaterBbl"))),
                Calc(1, "Label", Call("concat", Col("w", "WellName"), new TextNode(" / "), Col("w", "PlantCode"))),
            ],
            [],
            new ModelMeasure("Net Oil", new AggregateNode("sum", Col("d", "Net"))));

        var result = Run(model, new QueryRequest(1, ["w.Label"], ["Net Oil"], [new QueryFilter("d.ReportDate", "gte", ["2026-01-01"])]), PlantUser);

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT (COALESCE([OilBbl], 0) - COALESCE([WaterBbl], 0)) AS [Net], [ReportDate], [WellId] FROM [core].[WellDaily]),
            [w] AS (SELECT CONCAT([WellName], @p3, [PlantCode]) AS [Label], [WellId], [PlantCode] FROM [core].[Well])
            SELECT TOP (@top) [w].[Label] AS [w.Label], SUM([d].[Net]) AS [Net Oil]
            FROM [d]
            LEFT JOIN [w] ON [d].[WellId] = [w].[WellId]
            WHERE [d].[ReportDate] >= @p0 AND [w].[PlantCode] IN (@p1, @p2)
            GROUP BY [w].[Label]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = "2026-01-01", ["@p1"] = 101, ["@p2"] = 102, ["@p3"] = " / ", ["@top"] = QueryCompiler.DefaultTopN,
        });
    }

    [Fact]
    public void Transforms_apply_in_order_to_dimensions_and_to_measure_conditions()
    {
        var model = With(
            [],
            [
                new ModelTransform(1, "WellName", "trim"),
                new ModelTransform(1, "WellName", "null_fill", "Unnamed"),
                new ModelTransform(2, "WaterBbl", "null_fill", "0"),
            ],
            new ModelMeasure("Wet Days", new AggregateNode("count", Col("d", "ReportDate"),
                new MeasureCondition(Col("d", "WaterBbl"), "gt", "0"))));

        var result = Run(model, new QueryRequest(1, ["w.WellName"], ["Wet Days"]));

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT [ReportDate], COALESCE([WaterBbl], @p1) AS [WaterBbl], [WellId] FROM [core].[WellDaily]),
            [w] AS (SELECT COALESCE(LTRIM(RTRIM([WellName])), @p2) AS [WellName], [WellId] FROM [core].[Well])
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], COUNT(CASE WHEN [d].[WaterBbl] > @p0 THEN [d].[ReportDate] END) AS [Wet Days]
            FROM [d]
            LEFT JOIN [w] ON [d].[WellId] = [w].[WellId]
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = 0m, ["@p1"] = 0m, ["@p2"] = "Unnamed", ["@top"] = QueryCompiler.DefaultTopN,
        });
    }

    [Fact]
    public void A_source_without_calculated_columns_or_transforms_is_read_from_its_table()
        => Run(With([Calc(2, "OilMinutes", new BinaryNode("*", Col("d", "OilBbl"), new NumberNode(60)))], []),
                new QueryRequest(1, ["w.WellName"], ["Total Oil"]))
            .Sql.Should().Be("""
                WITH [d] AS (SELECT [OilBbl], [WellId] FROM [core].[WellDaily])
                SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]
                FROM [d]
                LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
                GROUP BY [w].[WellName]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void A_calculated_column_that_uses_another_is_expanded_in_place()
    {
        var result = Run(
            With([
                Calc(2, "Year", Call("year", Col("d", "ReportDate"))),
                Calc(2, "YearTag", Call("concat", new TextNode("Y"), Col("d", "Year"))),
            ], []),
            new QueryRequest(1, ["d.YearTag"], ["Total Oil"]));

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT CONCAT(@p0, YEAR([ReportDate])) AS [YearTag], [OilBbl] FROM [core].[WellDaily])
            SELECT TOP (@top) [d].[YearTag] AS [d.YearTag], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [d]
            GROUP BY [d].[YearTag]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@p0"].Should().Be("Y");
    }

    [Fact]
    public void A_transform_of_a_join_column_applies_to_the_join()
    {
        var result = Run(With([], [new ModelTransform(2, "WellId", "null_fill", "0")]), new QueryRequest(1, ["w.WellName"], ["Total Oil"]));

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT [OilBbl], COALESCE([WellId], @p0) AS [WellId] FROM [core].[WellDaily])
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@p0"].Should().Be(0m);
    }

    public static TheoryData<MeasureNode, string> RowFunctions => new()
    {
        { Call("left", Col("d", "Shift"), new NumberNode(3)), "LEFT([Shift], 3)" },
        { Call("RIGHT", Col("d", "Shift"), new NumberNode(3)), "RIGHT([Shift], 3)" },
        { Call("upper", Col("d", "Shift")), "UPPER([Shift])" },
        { Call("lower", Col("d", "Shift")), "LOWER([Shift])" },
        { Call("trim", Col("d", "Shift")), "LTRIM(RTRIM([Shift]))" },
        { Call("month", Col("d", "ReportDate")), "MONTH([ReportDate])" },
        { new BinaryNode("/", Col("d", "OilBbl"), Col("d", "WaterBbl")), "(1.0 * [OilBbl] / NULLIF([WaterBbl], 0))" },
        { new BinaryNode("*", Col("d", "OilBbl"), new NumberNode(-1)), "([OilBbl] * (-1))" },
    };

    [Theory]
    [MemberData(nameof(RowFunctions))]
    public void Row_functions_render_inside_the_cte(MeasureNode formula, string sql)
        => Run(With([Calc(2, "C", formula)], []), new QueryRequest(1, ["d.C"], []))
            .Sql.Should().StartWith($"WITH [d] AS (SELECT {sql} AS [C] FROM [core].[WellDaily])");

    private static readonly QueryRequest ByC = new(1, ["d.C"], []);

    private static void RefusedColumn(MeasureNode formula, string message)
        => Refused(With([Calc(2, "C", formula)], []), ByC, QueryErrors.InvalidColumn, message);

    [Fact]
    public void A_calculated_column_cannot_read_another_table()
        => RefusedColumn(new BinaryNode("*", Col("w", "Capacity"), new NumberNode(2)), "d.C can only use columns of d.");

    [Fact]
    public void A_calculated_column_cannot_aggregate()
        => RefusedColumn(new AggregateNode("sum", Col("d", "OilBbl")),
            "d.C uses SUM, which adds up many rows. A calculated column works on one row at a time; build a measure instead.");

    [Fact]
    public void A_calculated_column_must_calculate_something()
        => RefusedColumn(Col("d", "OilBbl"), "d.C must calculate something, for example d.column * 60 or YEAR(d.column).");

    [Fact]
    public void Arithmetic_needs_numbers()
        => RefusedColumn(new BinaryNode("*", Col("d", "Shift"), new NumberNode(2)), "+, -, * and / in d.C need numbers, but d.Shift holds text.");

    [Fact]
    public void Text_functions_need_text()
        => RefusedColumn(Call("upper", Col("d", "OilBbl")), "UPPER in d.C needs text, but d.OilBbl holds numbers.");

    [Fact]
    public void Year_and_month_need_a_date()
        => RefusedColumn(Call("year", Col("d", "Shift")), "YEAR in d.C needs a date, but d.Shift holds text.");

    [Fact]
    public void Concat_refuses_a_date()
        => RefusedColumn(Call("concat", Col("d", "ReportDate"), new TextNode("x")), "CONCAT in d.C needs text or numbers, but d.ReportDate holds dates.");

    [Fact]
    public void Left_needs_a_whole_number_of_characters()
    {
        const string message = "LEFT in d.C needs a whole number from 1 to 4000 as its second part.";
        RefusedColumn(Call("left", Col("d", "Shift"), new NumberNode(2.5m)), message);
        RefusedColumn(Call("left", Col("d", "Shift"), Col("d", "OilBbl")), message);
    }

    [Fact]
    public void A_function_with_the_wrong_number_of_parts_is_refused()
        => RefusedColumn(Call("upper", Col("d", "Shift"), Col("d", "Shift")), "UPPER in d.C takes 1 part.");

    [Fact]
    public void An_unknown_function_is_refused()
        => RefusedColumn(Call("sqrt", Col("d", "OilBbl")), "d.C uses an unknown function \"sqrt\".");

    [Fact]
    public void Calculated_columns_that_use_each_other_in_a_circle_are_refused()
        => Refused(
            With([
                Calc(2, "A", new BinaryNode("+", Col("d", "B"), new NumberNode(1))),
                Calc(2, "B", new BinaryNode("+", Col("d", "A"), new NumberNode(1))),
            ], []),
            new QueryRequest(1, ["d.A"], []), QueryErrors.InvalidColumn, "Calculated columns cannot use each other in a circle: d.A, d.B, d.A.");

    // C1 = OilBbl + 1, and each next one adds 1 to the one before.
    private static ModelCalculatedColumn[] Chain(int length) => Enumerable.Range(1, length)
        .Select(k => Calc(2, $"C{k}", new BinaryNode("+", Col("d", k == 1 ? "OilBbl" : $"C{k - 1}"), new NumberNode(1))))
        .ToArray();

    [Fact]
    public void Calculated_columns_may_build_on_each_other_eight_levels_deep()
        => FluentActions.Invoking(() => Run(With(Chain(8), []), new QueryRequest(1, ["d.C8"], []))).Should().NotThrow();

    [Fact]
    public void A_ninth_level_is_refused()
        => Refused(With(Chain(9), []), new QueryRequest(1, ["d.C9"], []), QueryErrors.InvalidColumn,
            "d.C9 builds on calculated columns more than 8 levels deep. Write it in fewer steps.");

    [Fact]
    public void An_unreadable_calculated_column_is_refused_when_used()
        => RefusedColumn(null!, "d.C is stored in a form that cannot be read. Edit it and save it again.");

    [Fact]
    public void A_calculated_column_named_like_a_table_column_is_refused()
        => Refused(With([Calc(2, "OilBbl", new BinaryNode("*", Col("d", "WaterBbl"), new NumberNode(2)))], []),
            new QueryRequest(1, ["d.OilBbl"], []), QueryErrors.InvalidColumn,
            "d has a column and a calculated column both called \"OilBbl\". Rename the calculated column.");

    [Fact]
    public void Sum_over_a_text_calculated_column_is_refused()
        => Refused(
            With([Calc(2, "Code", Call("upper", Col("d", "Shift")))], [], new ModelMeasure("M", new AggregateNode("sum", Col("d", "Code")))),
            new QueryRequest(1, [], ["M"]), QueryErrors.InvalidMeasure, "Sum needs a number column, but d.Code holds text.");

    [Fact]
    public void A_measure_cannot_use_a_row_function()
        => Refused(With([], [], new ModelMeasure("M", Call("upper", Col("d", "Shift")))), new QueryRequest(1, [], ["M"]),
            QueryErrors.InvalidMeasure,
            "M uses UPPER, which works on one row at a time. Add it as a calculated column, then use that column in the measure.");

    [Fact]
    public void A_measure_cannot_calculate_with_text()
        => Refused(
            With([], [], new ModelMeasure("M", new BinaryNode("+", new AggregateNode("sum", Col("d", "OilBbl")), new TextNode("1")))),
            new QueryRequest(1, [], ["M"]), QueryErrors.InvalidMeasure, "M uses text in a calculation. A measure calculates with numbers.");

    [Fact]
    public void Text_in_a_formula_never_reaches_the_sql_text()
    {
        const string hostile = "x'; DROP TABLE core.Well; --";

        var result = Run(With([Calc(2, "C", Call("concat", Col("d", "Shift"), new TextNode(hostile)))], []), ByC);

        result.Sql.Should().NotContain("DROP").And.NotContain("--");
        result.Parameters["@p0"].Should().Be(hostile);
    }

    [Fact]
    public void A_calculated_column_does_not_hide_a_fan_trap()
        => Refused(
            With([Calc(1, "Double", new BinaryNode("*", Col("w", "Capacity"), new NumberNode(2)))], [],
                new ModelMeasure("M", new AggregateNode("sum", Col("w", "Double")))),
            new QueryRequest(1, ["d.ReportDate"], ["M"]), QueryErrors.FanTrap,
            "M would count each w row once per matching d row. Remove the d fields from this query, or use a measure based on d.");

    [Fact]
    public void Trim_needs_a_text_column()
        => Refused(With([], [new ModelTransform(2, "OilBbl", "trim")]), new QueryRequest(1, ["d.OilBbl"], []),
            QueryErrors.InvalidColumn, "Trim works on text, but d.OilBbl holds numbers.");

    [Fact]
    public void A_fill_value_must_fit_the_column()
        => Refused(With([], [new ModelTransform(2, "WaterBbl", "null_fill", "none")]), new QueryRequest(1, ["d.WaterBbl"], []),
            QueryErrors.InvalidColumn, "Blanks in d.WaterBbl cannot be filled with \"none\" because it holds numbers. Use a number.");

    [Fact]
    public void A_fill_without_a_value_cannot_be_read()
        => Refused(With([], [new ModelTransform(2, "WaterBbl", "null_fill")]), new QueryRequest(1, ["d.WaterBbl"], []),
            QueryErrors.InvalidColumn, "A transform of d.WaterBbl cannot be read. Remove it and add it again.");

    [Fact]
    public void A_transform_kind_this_compiler_does_not_know_is_refused()
        => Refused(With([], [new ModelTransform(2, "Shift", "rename")]), new QueryRequest(1, ["d.Shift"], []),
            QueryErrors.InvalidColumn, "d.Shift has a \"rename\" transform, which is not supported yet. Remove it.");

    [Fact]
    public void A_transform_of_the_plant_column_is_refused_for_every_user()
        => Refused(With([], [new ModelTransform(1, "PlantCode", "null_fill", "101")]), new QueryRequest(1, ["w.WellName"], []),
            QueryErrors.RlsUnconfigured,
            "w.PlantCode decides who sees which rows, so a transform or a calculated column cannot change it. Remove the transform.");

    [Fact]
    public void Values_in_ctes_count_towards_the_parameter_cap()
    {
        var thousand = Enumerable.Range(0, 1000).Select(i => i.ToString()).ToList();

        Refused(With([Calc(2, "C", Call("concat", Col("d", "Shift"), new TextNode("x")))], []),
            new QueryRequest(1, ["d.C"], [], [new QueryFilter("d.OilBbl", "in", thousand), new QueryFilter("d.WaterBbl", "in", thousand)]),
            QueryErrors.InvalidFilter, "This query needs too many values. Use fewer filter values or conditions.");
    }

    private static IReadOnlyDictionary<string, string> Options(params (string Key, string Value)[] pairs)
        => pairs.ToDictionary(pair => pair.Key, pair => pair.Value);

    [Fact]
    public void Replace_changes_part_of_a_text_value()
    {
        var result = Run(With([], [new ModelTransform(2, "Shift", "replace", "-", Options(("with", "")))]), new QueryRequest(1, ["d.Shift"], []));

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT REPLACE([Shift], @p0, @p1) AS [Shift] FROM [core].[WellDaily])
            SELECT TOP (@top) [d].[Shift] AS [d.Shift]
            FROM [d]
            GROUP BY [d].[Shift]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@p0"].Should().Be("-");
        result.Parameters["@p1"].Should().Be("");
    }

    [Fact]
    public void Replace_of_a_whole_value_is_typed_like_the_column()
    {
        var result = Run(With([], [new ModelTransform(2, "WaterBbl", "replace", "-1", Options(("with", "0"), ("match", "whole")))]),
            new QueryRequest(1, ["d.WaterBbl"], []));

        result.Sql.Should().StartWith("WITH [d] AS (SELECT CASE WHEN [WaterBbl] = @p0 THEN @p1 ELSE [WaterBbl] END AS [WaterBbl] FROM [core].[WellDaily])");
        result.Parameters["@p0"].Should().Be(-1m);
        result.Parameters["@p1"].Should().Be(0m);
    }

    [Fact]
    public void Replacing_part_of_a_number_is_refused()
        => Refused(With([], [new ModelTransform(2, "OilBbl", "replace", "1", Options(("with", "2")))]), new QueryRequest(1, ["d.OilBbl"], []),
            QueryErrors.InvalidColumn, "Replacing part of a value works on text, but d.OilBbl holds numbers. Replace whole values instead.");

    [Fact]
    public void A_type_change_to_numbers_lets_a_measure_sum_the_column()
        => Run(With([], [new ModelTransform(2, "Shift", "type", "number")], new ModelMeasure("Shift Total", new AggregateNode("sum", Col("d", "Shift")))),
                new QueryRequest(1, [], ["Shift Total"]))
            .Sql.Should().Be("""
                WITH [d] AS (SELECT TRY_CONVERT(decimal(38, 6), REPLACE(REPLACE(REPLACE(REPLACE([Shift], N',', N''), N'$', N''), N'%', N''), N' ', N'')) AS [Shift] FROM [core].[WellDaily])
                SELECT TOP (@top) SUM([d].[Shift]) AS [Shift Total]
                FROM [d]
                """.ReplaceLineEndings("\n"));

    [Fact]
    public void A_type_change_to_dates_reads_the_order_they_are_written_in()
        => Run(With([], [new ModelTransform(2, "Shift", "type", "date", Options(("style", "dmy")))]), new QueryRequest(1, ["d.Shift"], []))
            .Sql.Should().StartWith("WITH [d] AS (SELECT TRY_CONVERT(date, [Shift], 103) AS [Shift] FROM [core].[WellDaily])");

    [Fact]
    public void Transforms_after_a_type_change_see_the_new_type()
        => Refused(With([], [new ModelTransform(2, "Shift", "type", "number"), new ModelTransform(2, "Shift", "trim")]),
            new QueryRequest(1, ["d.Shift"], []), QueryErrors.InvalidColumn, "Trim works on text, but d.Shift holds numbers.");

    [Fact]
    public void A_date_cannot_be_changed_to_numbers()
        => Refused(With([], [new ModelTransform(2, "ReportDate", "type", "number")]), new QueryRequest(1, ["d.ReportDate"], []),
            QueryErrors.InvalidColumn, "d.ReportDate holds dates, which cannot be changed to numbers.");

    [Fact]
    public void Removed_rows_are_left_out_inside_the_cte()
    {
        var result = Run(With([], [new ModelTransform(2, "Shift", "remove_rows", "Test", Options(("op", "eq")))]), new QueryRequest(1, [], ["Total Oil"]));

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT [OilBbl] FROM [core].[WellDaily] WHERE CASE WHEN [Shift] = @p0 THEN 1 ELSE 0 END = 0)
            SELECT TOP (@top) SUM([d].[OilBbl]) AS [Total Oil]
            FROM [d]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@p0"].Should().Be("Test");
    }

    [Fact]
    public void A_removal_tests_the_column_as_the_transforms_before_it_leave_it()
    {
        var model = With([], [
            new ModelTransform(2, "Shift", "trim"),
            new ModelTransform(2, "Shift", "remove_rows", null, Options(("op", "blank"))),
            new ModelTransform(2, "Shift", "null_fill", "Day"),
        ]);

        var result = Run(model, new QueryRequest(1, ["d.Shift"], []));

        result.Sql.Should().Be("""
            WITH [d] AS (SELECT COALESCE(LTRIM(RTRIM([Shift])), @p0) AS [Shift] FROM [core].[WellDaily] WHERE CASE WHEN (LTRIM(RTRIM([Shift])) IS NULL OR LTRIM(RTRIM([Shift])) = N'') THEN 1 ELSE 0 END = 0)
            SELECT TOP (@top) [d].[Shift] AS [d.Shift]
            FROM [d]
            GROUP BY [d].[Shift]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@p0"].Should().Be("Day");
    }

    [Fact]
    public void Removing_rows_of_a_plant_scoped_table_keeps_the_plant_predicate_outside_the_cte()
    {
        var model = With([], [new ModelTransform(1, "WellName", "remove_rows", "Test", Options(("op", "contains")))]);

        var result = Run(model, new QueryRequest(1, ["w.WellName"], ["Total Oil"]), PlantUser);

        result.Sql.Should().Be("""
            WITH [w] AS (SELECT [WellName], [WellId], [PlantCode] FROM [core].[Well] WHERE CASE WHEN [WellName] LIKE @p2 ESCAPE N'\' THEN 1 ELSE 0 END = 0)
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [w] ON [d].[WellId] = [w].[WellId]
            WHERE [w].[PlantCode] IN (@p0, @p1)
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = 101, ["@p1"] = 102, ["@p2"] = "%Test%", ["@top"] = QueryCompiler.DefaultTopN,
        });
    }

    [Theory]
    [InlineData("contains")]
    [InlineData("starts_with")]
    [InlineData("ends_with")]
    public void A_removal_by_text_needs_text_to_look_for(string op)
        => Refused(With([], [new ModelTransform(2, "Shift", "remove_rows", "", Options(("op", op)))]), new QueryRequest(1, [], ["Total Oil"]),
            QueryErrors.InvalidColumn, "A transform of d.Shift cannot be read. Remove it and add it again.");

    // Style 3 writes every digit of a float, where the default style would write 1234567.0 as 1.23457e+006.
    [Theory]
    [InlineData("float")]
    [InlineData("real")]
    public void A_float_changed_to_text_keeps_every_digit(string type)
        => QueryCompiler.Compile(With([], [new ModelTransform(2, "Density", "type", "text")]), new QueryRequest(1, ["d.Density"], []), Admin,
                new SchemaCatalog([("core", "Well", "WellId", "int"), ("core", "WellDaily", "WellId", "int"), ("core", "WellDaily", "Density", type)]))
            .Sql.Should().StartWith("WITH [d] AS (SELECT CONVERT(nvarchar(4000), [Density], 3) AS [Density] FROM [core].[WellDaily])");

    [Fact]
    public void A_removal_value_must_fit_the_column()
        => Refused(With([], [new ModelTransform(2, "OilBbl", "remove_rows", "many", Options(("op", "gt")))]), new QueryRequest(1, [], ["Total Oil"]),
            QueryErrors.InvalidColumn, "Rows of d.OilBbl cannot be compared with \"many\" because it holds numbers. Use a number.");
}
