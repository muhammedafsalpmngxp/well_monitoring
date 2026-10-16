using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class QueryCompilerTests
{
    // Fixture: wells (plant-scoped) and their daily production (no RLS of its own).
    internal static readonly ModelSource Well = new(1, "w", "core", "Well", "plant", "PlantCode");
    internal static readonly ModelSource Daily = new(2, "d", "core", "WellDaily", "none", null);
    internal static readonly ModelRelationship DailyToWell = new(10, 2, "WellId", 1, "WellId", "many_to_one");

    internal static readonly SchemaCatalog Catalog = new([
        ("core", "Well", "WellId"), ("core", "Well", "WellName"), ("core", "Well", "PlantCode"), ("core", "Well", "Capacity"),
        ("core", "WellDaily", "WellId"), ("core", "WellDaily", "ReportDate"), ("core", "WellDaily", "OilBbl"), ("core", "WellDaily", "WaterBbl"),
    ]);

    internal static readonly ModelMeasure TotalOil = new("Total Oil", new AggregateNode("sum", new ColumnNode("d", "OilBbl")));

    internal static DatasetModel Model(params ModelMeasure[] extra)
        => new([Well, Daily], [DailyToWell], [TotalOil, .. extra]);

    internal static readonly UserScope PlantUser = new(false, [101, 102]);
    internal static readonly UserScope Admin = new(true, []);

    internal static CompiledQuery Compile(QueryRequest request, UserScope? user = null, DatasetModel? model = null)
        => QueryCompiler.Compile(model ?? Model(), request, user ?? PlantUser, Catalog);

    [Fact]
    public void Dimension_measure_filter_and_rls_compile_to_one_parameterised_select()
    {
        var result = Compile(new QueryRequest(1, ["w.WellName"], ["Total Oil"],
            [new QueryFilter("d.ReportDate", "gte", ["2026-01-01"])], TopN: 100));

        result.Sql.Should().Be("""
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            WHERE [d].[ReportDate] >= @p0 AND [w].[PlantCode] IN (@p1, @p2)
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = "2026-01-01", ["@p1"] = 101, ["@p2"] = 102, ["@top"] = 100,
        });
        result.Columns.Should().Equal("w.WellName", "Total Oil");
    }

    [Fact]
    public void Totals_roll_up_the_rows_left_by_the_plant_filter_with_the_grand_total_first()
    {
        var result = Compile(new QueryRequest(1, ["w.WellName", "d.ReportDate"], ["Total Oil"], TopN: 100, Totals: true));

        result.Sql.Should().Be("""
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], [d].[ReportDate] AS [d.ReportDate], SUM([d].[OilBbl]) AS [Total Oil], GROUPING_ID([w].[WellName], [d].[ReportDate]) AS [__level]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            WHERE [w].[PlantCode] IN (@p0, @p1)
            GROUP BY ROLLUP([w].[WellName], [d].[ReportDate])
            ORDER BY GROUPING([w].[WellName]) DESC, [w].[WellName], GROUPING([d].[ReportDate]) DESC, [d].[ReportDate]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object> { ["@p0"] = 101, ["@p1"] = 102, ["@top"] = 100 });
        result.Columns.Should().Equal("w.WellName", "d.ReportDate", "Total Oil", QueryCompiler.LevelColumn);

        // SQL Server applies WHERE before GROUP BY, so every subtotal and the grand total add up only rows of the
        // user's plants. That holds only while nothing aggregates outside this one SELECT: no subquery, no window.
        result.Sql.Split("SELECT").Should().HaveCount(2);
        result.Sql.Should().NotContain(" OVER ");
    }

    [Fact]
    public void Totals_over_a_source_read_through_a_cte_add_up_only_rows_past_the_filters_and_the_plant_filter()
    {
        var model = Model() with { Transforms = [new ModelTransform(1, "WellName", "trim")] };
        var result = Compile(new QueryRequest(1, ["w.WellName"], ["Total Oil"],
            [new QueryFilter("d.ReportDate", "gte", ["2026-01-01"])], Totals: true), model: model);

        result.Sql.Should().Be("""
            WITH [w] AS (SELECT LTRIM(RTRIM([WellName])) AS [WellName], [WellId], [PlantCode] FROM [core].[Well])
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil], GROUPING_ID([w].[WellName]) AS [__level]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [w] ON [d].[WellId] = [w].[WellId]
            WHERE [d].[ReportDate] >= @p0 AND [w].[PlantCode] IN (@p1, @p2)
            GROUP BY ROLLUP([w].[WellName])
            ORDER BY GROUPING([w].[WellName]) DESC, [w].[WellName]
            """.ReplaceLineEndings("\n"));
    }

    [Fact]
    public void Totals_for_a_user_with_no_plants_add_up_nothing()
        => Compile(new QueryRequest(1, ["w.WellName"], ["Total Oil"], Totals: true), new UserScope(false, []))
            .Sql.Should().Contain("WHERE 1 = 0\nGROUP BY ROLLUP([w].[WellName])");

    [Fact]
    public void Totals_need_a_field_and_a_measure_and_take_no_other_sort()
    {
        foreach (var request in new[]
        {
            new QueryRequest(1, [], ["Total Oil"], Totals: true),
            new QueryRequest(1, ["w.WellName"], [], Totals: true),
            new QueryRequest(1, ["w.WellName"], ["Total Oil"], Sort: new QuerySort("Total Oil", true), Totals: true),
        })
        {
            var compile = () => Compile(request);
            compile.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidTotals);
        }
    }

    [Fact]
    public void Single_source_query_has_no_join_and_no_rls_when_the_source_opts_out()
    {
        var result = Compile(new QueryRequest(1, ["d.ReportDate"], ["Total Oil"]));

        result.Sql.Should().Be("""
            SELECT TOP (@top) [d].[ReportDate] AS [d.ReportDate], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            GROUP BY [d].[ReportDate]
            """.ReplaceLineEndings("\n"));
        result.Parameters["@top"].Should().Be(QueryCompiler.DefaultTopN);
    }

    [Fact]
    public void Measure_only_query_has_no_group_by()
        => Compile(new QueryRequest(1, [], ["Total Oil"])).Sql.Should().Be("""
            SELECT TOP (@top) SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            """.ReplaceLineEndings("\n"));

    [Fact]
    public void Ratio_measure_guards_division_by_zero()
    {
        var waterCut = new ModelMeasure("Water Cut", new BinaryNode("/",
            new AggregateNode("sum", new ColumnNode("d", "WaterBbl")),
            new BinaryNode("+", new AggregateNode("sum", new ColumnNode("d", "WaterBbl")), new AggregateNode("sum", new ColumnNode("d", "OilBbl")))));

        Compile(new QueryRequest(1, [], ["Water Cut"]), model: Model(waterCut)).Sql.Should().StartWith(
            "SELECT TOP (@top) (1.0 * SUM([d].[WaterBbl]) / NULLIF((COALESCE(SUM([d].[WaterBbl]), 0) + COALESCE(SUM([d].[OilBbl]), 0)), 0)) AS [Water Cut]");
    }

    [Fact]
    public void Ratio_of_two_counts_is_not_integer_division()
    {
        var share = new ModelMeasure("Share", new BinaryNode("/",
            new AggregateNode("count", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "7")),
            new AggregateNode("count", new ColumnNode("d", "OilBbl"))));

        Compile(new QueryRequest(1, [], ["Share"]), model: Model(share)).Sql.Should().StartWith(
            "SELECT TOP (@top) (1.0 * COUNT(CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END) / NULLIF(COUNT([d].[OilBbl]), 0)) AS [Share]");
    }

    [Fact]
    public void Blank_side_of_a_sum_counts_as_zero()
    {
        var both = new ModelMeasure("Both", new BinaryNode("+",
            new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "7")),
            new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "8"))));

        Compile(new QueryRequest(1, [], ["Both"]), model: Model(both)).Sql.Should().StartWith(
            "SELECT TOP (@top) (COALESCE(SUM(CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END), 0)"
            + " + COALESCE(SUM(CASE WHEN [d].[WellId] = @p1 THEN [d].[OilBbl] END), 0)) AS [Both]");
    }

    [Fact]
    public void Product_keeps_a_blank_side_blank()
    {
        var scaled = new ModelMeasure("Scaled", new BinaryNode("*", new AggregateNode("sum", new ColumnNode("d", "OilBbl")), new NumberNode(2)));

        Compile(new QueryRequest(1, [], ["Scaled"]), model: Model(scaled)).Sql.Should().StartWith(
            "SELECT TOP (@top) (SUM([d].[OilBbl]) * 2) AS [Scaled]");
    }

    [Theory]
    [InlineData("avg", "AVG(1.0 * [d].[OilBbl])")]
    [InlineData("count", "COUNT([d].[OilBbl])")]
    [InlineData("count_distinct", "COUNT(DISTINCT [d].[OilBbl])")]
    [InlineData("min", "MIN([d].[OilBbl])")]
    [InlineData("max", "MAX([d].[OilBbl])")]
    public void Aggregate_functions_render(string fn, string sql)
    {
        var measure = new ModelMeasure("M", new AggregateNode(fn, new ColumnNode("d", "OilBbl")));

        Compile(new QueryRequest(1, [], ["M"]), model: Model(measure)).Sql.Should().StartWith($"SELECT TOP (@top) {sql} AS [M]");
    }

    [Theory]
    [InlineData("eq", new[] { "5" }, "[d].[OilBbl] = @p0")]
    [InlineData("neq", new[] { "5" }, "[d].[OilBbl] <> @p0")]
    [InlineData("lt", new[] { "5" }, "[d].[OilBbl] < @p0")]
    [InlineData("in", new[] { "1", "2", "3" }, "[d].[OilBbl] IN (@p0, @p1, @p2)")]
    [InlineData("between", new[] { "1", "9" }, "[d].[OilBbl] BETWEEN @p0 AND @p1")]
    [InlineData("is_null", new string[0], "[d].[OilBbl] IS NULL")]
    [InlineData("not_null", new string[0], "[d].[OilBbl] IS NOT NULL")]
    [InlineData("not_in", new[] { "1", "2" }, "([d].[OilBbl] IS NULL OR [d].[OilBbl] NOT IN (@p0, @p1))")]
    [InlineData("contains", new[] { "5" }, "[d].[OilBbl] LIKE @p0 ESCAPE N'\'")]
    [InlineData("not_contains", new[] { "5" }, "([d].[OilBbl] IS NULL OR [d].[OilBbl] NOT LIKE @p0 ESCAPE N'\')")]
    public void Filters_render_with_parameters(string op, string[] values, string predicate)
        => Compile(new QueryRequest(1, [], ["Total Oil"], [new QueryFilter("d.OilBbl", op, values)]))
            .Sql.Should().Contain($"WHERE {predicate}");

    [Fact]
    public void An_any_filter_keeps_a_row_when_one_of_its_conditions_does()
        => Compile(new QueryRequest(1, [], ["Total Oil"], [new QueryFilter("d.OilBbl", "any", Any: [
                new QueryFilter("d.OilBbl", "lt", ["5"]), new QueryFilter("d.OilBbl", "gt", ["90"])])]))
            .Sql.Should().Contain("WHERE ([d].[OilBbl] < @p0 OR [d].[OilBbl] > @p1)");

    [Fact]
    public void Sort_by_measure_and_top_n_is_capped()
    {
        var result = Compile(new QueryRequest(1, ["d.ReportDate"], ["Total Oil"], Sort: new QuerySort("Total Oil", true), TopN: 1_000_000));

        result.Sql.Should().EndWith("ORDER BY [Total Oil] DESC");
        result.Parameters["@top"].Should().Be(QueryCompiler.MaxTopN);
    }

    [Fact]
    public void Hostile_measure_name_is_bracket_escaped_in_the_alias_and_the_sort()
    {
        var hostile = new ModelMeasure("Oil] FROM x; --", new AggregateNode("sum", new ColumnNode("d", "OilBbl")));

        var sql = Compile(new QueryRequest(1, [], [hostile.Name], Sort: new QuerySort(hostile.Name)), model: Model(hostile)).Sql;

        sql.Should().Contain("AS [Oil]] FROM x; --]").And.EndWith("ORDER BY [Oil]] FROM x; --]");
    }

    [Fact]
    public void Negative_number_cannot_form_a_comment_marker()
    {
        var measure = new ModelMeasure("M", new BinaryNode("-", new AggregateNode("sum", new ColumnNode("d", "OilBbl")), new NumberNode(-1)));

        var sql = Compile(new QueryRequest(1, [], ["M"]), model: Model(measure)).Sql;

        sql.Should().StartWith("SELECT TOP (@top) (COALESCE(SUM([d].[OilBbl]), 0) - (-1)) AS [M]").And.NotContain("--");
    }

    private static ModelMeasure Conditional(string name, string fn, string column, string op, string value)
        => new(name, new AggregateNode(fn, new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", column), op, value)));

    [Fact]
    public void Conditional_measure_compiles_to_a_case_with_its_value_as_the_first_parameter()
    {
        var result = Compile(
            new QueryRequest(1, ["w.WellName"], ["Well 7 Oil"], [new QueryFilter("d.ReportDate", "gte", ["2026-01-01"])]),
            model: Model(Conditional("Well 7 Oil", "sum", "WellId", "eq", "7")));

        result.Sql.Should().Be("""
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM(CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END) AS [Well 7 Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            WHERE [d].[ReportDate] >= @p1 AND [w].[PlantCode] IN (@p2, @p3)
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = "7", ["@p1"] = "2026-01-01", ["@p2"] = 101, ["@p3"] = 102, ["@top"] = QueryCompiler.DefaultTopN,
        });
    }

    [Fact]
    public void Two_conditions_in_one_measure_take_parameters_in_order_before_filters_and_rls()
    {
        var rate = new ModelMeasure("Rate", new BinaryNode("/",
            new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "7")),
            new AggregateNode("count", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WaterBbl"), "gt", "0"))));

        var result = Compile(
            new QueryRequest(1, ["w.WellName"], ["Rate"], [new QueryFilter("d.ReportDate", "gte", ["2026-01-01"])]),
            model: Model(rate));

        result.Sql.Should().Be("""
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], (1.0 * SUM(CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END) / NULLIF(COUNT(CASE WHEN [d].[WaterBbl] > @p1 THEN [d].[OilBbl] END), 0)) AS [Rate]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            WHERE [d].[ReportDate] >= @p2 AND [w].[PlantCode] IN (@p3, @p4)
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
        result.Parameters.Should().Equal(new Dictionary<string, object>
        {
            ["@p0"] = "7", ["@p1"] = "0", ["@p2"] = "2026-01-01", ["@p3"] = 101, ["@p4"] = 102, ["@top"] = QueryCompiler.DefaultTopN,
        });
    }

    [Theory]
    [InlineData("count", "COUNT(CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END)")]
    [InlineData("count_distinct", "COUNT(DISTINCT CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END)")]
    [InlineData("avg", "AVG(1.0 * CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END)")]
    [InlineData("min", "MIN(CASE WHEN [d].[WellId] = @p0 THEN [d].[OilBbl] END)")]
    public void Every_aggregate_takes_a_condition(string fn, string sql)
        => Compile(new QueryRequest(1, [], ["M"]), model: Model(Conditional("M", fn, "WellId", "eq", "7")))
            .Sql.Should().StartWith($"SELECT TOP (@top) {sql} AS [M]");

    [Theory]
    [InlineData("neq", "<>")]
    [InlineData("gt", ">")]
    [InlineData("gte", ">=")]
    [InlineData("lt", "<")]
    [InlineData("LTE", "<=")]
    public void Condition_comparisons_render(string op, string symbol)
        => Compile(new QueryRequest(1, [], ["M"]), model: Model(Conditional("M", "sum", "WaterBbl", op, "0")))
            .Sql.Should().StartWith($"SELECT TOP (@top) SUM(CASE WHEN [d].[WaterBbl] {symbol} @p0 THEN [d].[OilBbl] END) AS [M]");

    [Fact]
    public void Identifiers_are_bracket_escaped()
    {
        var odd = new ModelSource(3, "x]y", "core", "Odd]Table", "none", null);
        var catalog = new SchemaCatalog([("core", "Odd]Table", "Col]1")]);

        var result = QueryCompiler.Compile(new DatasetModel([odd], [], []), new QueryRequest(1, ["x]y.Col]1"], []), PlantUser, catalog);

        result.Sql.Should().Contain("[x]]y].[Col]]1] AS [x]]y.Col]]1]").And.Contain("FROM [core].[Odd]]Table] AS [x]]y]");
    }

    [Fact]
    public void Measure_from_the_many_side_starts_from_its_source_and_left_joins_the_one_side()
        => Compile(new QueryRequest(1, ["w.WellName"], ["Total Oil"]), Admin).Sql.Should().Be("""
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));

    [Theory]
    [InlineData("w.WellName", "d.ReportDate", "FROM [core].[Well] AS [w]\nLEFT JOIN [core].[WellDaily] AS [d] ON [d].[WellId] = [w].[WellId]")]
    [InlineData("d.ReportDate", "w.WellName", "FROM [core].[WellDaily] AS [d]\nLEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]")]
    public void Query_without_measures_starts_from_the_first_dimensions_source(string first, string second, string from)
        => Compile(new QueryRequest(1, [first, second], []), Admin).Sql.Should().Contain(from);

    [Fact]
    public void Measure_only_query_starts_from_the_measures_source()
        => Compile(new QueryRequest(1, [], ["Total Oil"], [new QueryFilter("w.WellName", "eq", ["A"])]), Admin).Sql.Should().Be("""
            SELECT TOP (@top) SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            WHERE [w].[WellName] = @p0
            """.ReplaceLineEndings("\n"));

    // A filter or the plant predicate on a left-joined source stays in WHERE, so it drops the rows
    // with no match there: a filter asks for a value, and a row whose plant is unknown is not shown.
    [Fact]
    public void Filter_and_plant_predicate_on_a_left_joined_source_stay_in_where()
        => Compile(new QueryRequest(1, ["d.ReportDate"], ["Total Oil"], [new QueryFilter("w.WellName", "eq", ["A"])])).Sql.Should().Be("""
            SELECT TOP (@top) [d].[ReportDate] AS [d.ReportDate], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            WHERE [w].[WellName] = @p0 AND [w].[PlantCode] IN (@p1, @p2)
            GROUP BY [d].[ReportDate]
            """.ReplaceLineEndings("\n"));

    [Fact]
    public void A_table_of_another_database_is_read_with_its_database_name_and_the_rest_as_before()
    {
        var model = Model() with { Sources = [Well with { Database = "AlTasnimBI" }, Daily] };

        Compile(new QueryRequest(1, ["w.WellName"], ["Total Oil"]), Admin, model).Sql.Should().Be("""
            SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]
            FROM [core].[WellDaily] AS [d]
            LEFT JOIN [AlTasnimBI].[core].[Well] AS [w] ON [d].[WellId] = [w].[WellId]
            GROUP BY [w].[WellName]
            """.ReplaceLineEndings("\n"));
    }

    [Fact]
    public void A_sample_and_a_cte_of_a_table_of_another_database_name_its_database()
    {
        var other = Daily with { Database = "Trial]DB" };
        QueryCompiler.Sample(other, ["OilBbl"], Catalog, 5).Sql.Should().Contain("FROM [Trial]]DB].[core].[WellDaily] AS [d]");

        var model = Model() with { Sources = [Well, other], Transforms = [new ModelTransform(2, "OilBbl", "null_fill", "0")] };
        Compile(new QueryRequest(1, [], ["Total Oil"]), Admin, model).Sql.Should().Contain("FROM [Trial]]DB].[core].[WellDaily])");
    }
}
