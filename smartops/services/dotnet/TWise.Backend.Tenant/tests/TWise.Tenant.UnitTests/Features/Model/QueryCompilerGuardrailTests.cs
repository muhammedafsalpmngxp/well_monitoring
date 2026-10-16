using TWise.Tenant.Application.Features.Model.Query;
using static TWise.Tenant.UnitTests.Features.Model.QueryCompilerTests;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class QueryCompilerGuardrailTests
{
    private static readonly ModelMeasure TotalCapacity = new("Total Capacity", new AggregateNode("sum", new ColumnNode("w", "Capacity")));

    private static Action Run(QueryRequest request, DatasetModel? model = null, UserScope? user = null)
        => () => Compile(request, user, model);

    [Fact]
    public void Summing_the_one_side_across_a_join_to_the_many_side_is_a_fan_trap()
        => Run(new QueryRequest(1, ["d.ReportDate"], ["Total Capacity"]), QueryCompilerTests.Model(TotalCapacity))
            .Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.FanTrap && e.Message.Contains("Total Capacity"));

    [Theory]
    [InlineData("Many_To_One")]
    [InlineData("many_to_one ")]
    [InlineData("unexpected")]
    public void Fan_trap_is_refused_whatever_the_stored_cardinality_spelling(string cardinality)
    {
        var model = new DatasetModel([Well, Daily], [DailyToWell with { Cardinality = cardinality }], [TotalCapacity]);

        Run(new QueryRequest(1, ["d.ReportDate"], ["Total Capacity"]), model)
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.FanTrap);
    }

    [Theory]
    [InlineData("max")]
    [InlineData("min")]
    [InlineData("count_distinct")]
    public void Aggregates_unaffected_by_repeated_rows_are_not_fan_traps(string fn)
    {
        var measure = new ModelMeasure("M", new AggregateNode(fn, new ColumnNode("w", "Capacity")));

        Run(new QueryRequest(1, ["d.ReportDate"], ["M"]), QueryCompilerTests.Model(measure)).Should().NotThrow();
    }

    [Fact]
    public void Summing_the_many_side_grouped_by_the_one_side_is_not_a_fan_trap()
        => Run(new QueryRequest(1, ["w.WellName"], ["Total Oil"])).Should().NotThrow();

    [Fact]
    public void Unrelated_sources_are_blocked()
        => Run(new QueryRequest(1, ["w.WellName"], ["Total Oil"]), new DatasetModel([Well, Daily], [], [TotalOil]))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.MissingRelationship);

    [Fact]
    public void Two_relationships_between_the_same_sources_are_blocked()
    {
        var second = new ModelRelationship(11, 2, "WellId", 1, "WellId", "many_to_one");

        Run(new QueryRequest(1, ["w.WellName"], ["Total Oil"]), new DatasetModel([Well, Daily], [DailyToWell, second], [TotalOil]))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.AmbiguousPath);
    }

    // A second fact, many_to_one to w like d. Reuses the WellDaily catalogue entries.
    private static readonly ModelSource Crew = new(3, "c", "core", "WellDaily", "none", null);
    private static readonly ModelRelationship CrewToWell = new(12, 3, "WellId", 1, "WellId", "many_to_one");

    [Fact]
    public void Fan_trap_across_two_hops_through_a_second_fact_is_refused()
        => Run(new QueryRequest(1, ["c.ReportDate"], ["Total Oil"]), new DatasetModel([Well, Daily, Crew], [DailyToWell, CrewToWell], [TotalOil]))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.FanTrap);

    [Fact]
    public void Fan_out_reached_only_through_a_filter_is_refused()
        => Run(new QueryRequest(1, [], ["Total Capacity"], [new QueryFilter("d.ReportDate", "gte", ["2026-01-01"])]), QueryCompilerTests.Model(TotalCapacity))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.FanTrap);

    [Fact]
    public void One_to_one_relationship_is_never_a_fan_trap()
    {
        var model = new DatasetModel([Well, Daily], [DailyToWell with { Cardinality = "one_to_one" }], [TotalOil, TotalCapacity]);

        Run(new QueryRequest(1, ["d.ReportDate"], ["Total Capacity"]), model).Should().NotThrow();
        Run(new QueryRequest(1, ["w.WellName"], ["Total Oil"]), model).Should().NotThrow();
    }

    [Fact]
    public void Rls_on_a_bridge_source_fails_closed_for_a_user_with_no_plants_and_is_absent_for_an_admin()
    {
        var model = new DatasetModel([Well, Daily, Crew], [DailyToWell, CrewToWell], []);
        var request = new QueryRequest(1, ["c.ReportDate", "d.ReportDate"], []);

        Compile(request, new UserScope(false, []), model).Sql.Should().Contain("WHERE 1 = 0");
        Compile(request, Admin, model).Sql.Should().NotContain("WHERE").And.NotContain("PlantCode");
    }

    [Fact]
    public void Plant_scoped_source_is_filtered_by_the_users_plants()
        => Compile(new QueryRequest(1, ["w.WellName"], [])).Sql
            .Should().Contain("WHERE [w].[PlantCode] IN (@p0, @p1)");

    [Fact]
    public void Rls_applies_to_a_source_joined_only_as_a_bridge()
    {
        // Querying only d and c still joins through w, so w's predicate must apply.
        // No measure: summing across two many sides would be a fan trap, which is not under test here.
        var crew = new ModelSource(3, "c", "core", "WellDaily", "none", null);
        var crewToWell = new ModelRelationship(12, 3, "WellId", 1, "WellId", "many_to_one");
        var model = new DatasetModel([Well, Daily, crew], [DailyToWell, crewToWell], []);

        Compile(new QueryRequest(1, ["c.ReportDate", "d.ReportDate"], []), model: model).Sql
            .Should().Contain("[w].[PlantCode] IN (@p0, @p1)");
    }

    [Fact]
    public void User_with_no_plants_sees_nothing_from_a_plant_scoped_source()
        => Compile(new QueryRequest(1, ["w.WellName"], []), new UserScope(false, [])).Sql
            .Should().Contain("WHERE 1 = 0");

    [Fact]
    public void Admin_is_not_filtered()
        => Compile(new QueryRequest(1, ["w.WellName"], []), Admin).Sql
            .Should().NotContain("WHERE");

    [Fact]
    public void Source_without_an_rls_decision_cannot_be_queried()
    {
        var undecided = Well with { RlsMode = "", RlsPlantColumn = null };

        Run(new QueryRequest(1, ["w.WellName"], []), new DatasetModel([undecided], [], []), Admin)
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.RlsUnconfigured);
    }

    [Fact]
    public void Rls_column_must_exist()
    {
        var wrong = Well with { RlsPlantColumn = "NoSuchColumn" };

        Run(new QueryRequest(1, ["w.WellName"], []), new DatasetModel([wrong], [], []))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);
    }

    [Theory]
    [InlineData("w.NoSuchColumn")]
    [InlineData("zz.WellName")]
    [InlineData("WellName")]
    [InlineData("w.WellName]; DROP TABLE core.Well; --")]
    public void Unknown_or_hostile_fields_are_refused(string field)
        => Run(new QueryRequest(1, [field], []))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);

    [Fact]
    public void Filter_values_never_reach_the_sql_text()
    {
        const string hostile = "x'; DROP TABLE core.Well; --";

        var result = Compile(new QueryRequest(1, ["w.WellName"], [], [new QueryFilter("w.WellName", "eq", [hostile])]));

        result.Sql.Should().NotContain("DROP");
        result.Parameters.Values.Should().Contain(hostile);
    }

    [Fact]
    public void Unknown_measure_is_refused()
        => Run(new QueryRequest(1, [], ["No Such Measure"]))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);

    [Fact]
    public void Measure_that_does_not_aggregate_is_refused()
    {
        var bare = new ModelMeasure("Bare", new BinaryNode("+", new ColumnNode("d", "OilBbl"), new NumberNode(1)));

        Run(new QueryRequest(1, [], ["Bare"]), QueryCompilerTests.Model(bare))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure);
    }

    [Fact]
    public void Constant_measure_with_no_column_is_refused()
    {
        var constant = new ModelMeasure("Constant", new NumberNode(5));

        Run(new QueryRequest(1, [], ["Constant"]), QueryCompilerTests.Model(constant))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure);
    }

    [Theory]
    [InlineData("eq", 0)]
    [InlineData("between", 1)]
    [InlineData("in", 0)]
    [InlineData("like", 1)]
    public void Incomplete_or_unknown_filters_are_refused(string op, int valueCount)
        => Run(new QueryRequest(1, [], ["Total Oil"], [new QueryFilter("d.OilBbl", op, Enumerable.Repeat("1", valueCount).ToList())]))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidFilter);

    public static TheoryData<MeasureNode> MalformedAsts => new()
    {
        new AggregateNode(null!, new ColumnNode("d", "OilBbl")),
        new AggregateNode("sum", null!),
        new AggregateNode("sum", new ColumnNode(null!, "OilBbl")),
        new AggregateNode("sum", new ColumnNode("d", null!)),
        new BinaryNode("+", new AggregateNode("sum", new ColumnNode(null!, null!)), new NumberNode(1)),
        new BinaryNode("+", new AggregateNode("sum", new ColumnNode("d", "OilBbl")), null!),
        new ColumnNode(null!, null!),
        new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(null!, "eq", "1")),
        new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), null!, "1")),
        new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", null!)),
    };

    [Theory]
    [MemberData(nameof(MalformedAsts))]
    public void Malformed_stored_measure_is_refused_as_invalid(MeasureNode ast)
        => Run(new QueryRequest(1, [], ["Broken"]), QueryCompilerTests.Model(new ModelMeasure("Broken", ast)))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure);

    [Fact]
    public void Null_dimensions_or_measures_are_treated_as_empty()
    {
        Run(new QueryRequest(1, null!, ["Total Oil"])).Should().NotThrow();
        Run(new QueryRequest(1, ["w.WellName"], null!)).Should().NotThrow();
        Run(new QueryRequest(1, null!, null!)).Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.EmptyRequest);
    }

    [Fact]
    public void Null_dimension_or_measure_name_is_an_unknown_field()
    {
        Run(new QueryRequest(1, [null!], [])).Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);
        Run(new QueryRequest(1, [], [null!])).Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);
    }

    public static TheoryData<QueryFilter> MalformedFilters => new()
    {
        null!,
        new QueryFilter(null!, "eq", ["1"]),
        new QueryFilter("d.OilBbl", null!, ["1"]),
        new QueryFilter("d.OilBbl", "eq", [null!]),
        new QueryFilter("d.OilBbl", "in", ["1", null!]),
    };

    [Theory]
    [MemberData(nameof(MalformedFilters))]
    public void Malformed_filter_is_refused(QueryFilter filter)
        => Run(new QueryRequest(1, [], ["Total Oil"], [filter]))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidFilter);

    [Fact]
    public void Sort_with_no_field_is_refused()
        => Run(new QueryRequest(1, ["w.WellName"], [], Sort: new QuerySort(null!)))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);

    [Fact]
    public void User_with_null_plant_list_sees_nothing_from_a_plant_scoped_source()
        => Compile(new QueryRequest(1, ["w.WellName"], []), new UserScope(false, null!)).Sql
            .Should().Contain("WHERE 1 = 0");

    [Fact]
    public void Too_many_filter_values_in_total_are_refused()
    {
        var values = Enumerable.Range(0, 700).Select(i => i.ToString()).ToList();
        var filters = new[] { "d.OilBbl", "d.WaterBbl", "d.WellId" }.Select(f => new QueryFilter(f, "in", values)).ToList();

        Run(new QueryRequest(1, [], ["Total Oil"], filters))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidFilter && e.Message == TooManyValues);
    }

    private const string TooManyValues = "This query needs too many values. Use fewer filter values or conditions.";

    [Fact]
    public void Condition_values_that_push_the_total_over_the_cap_are_refused_with_the_same_message()
    {
        // 1,999 filter values: one condition reaches the cap of 2,000, a second goes over it.
        var filters = new[] { ("d.OilBbl", 1000), ("d.WaterBbl", 999) }
            .Select(f => new QueryFilter(f.Item1, "in", Enumerable.Range(0, f.Item2).Select(i => i.ToString()).ToList())).ToList();
        var request = new QueryRequest(1, [], ["M"], filters);

        Run(request, WithCondition("sum", "d", "OilBbl", "d", "WellId", "eq", "7"), Admin).Should().NotThrow();
        Run(request, QueryCompilerTests.Model(new ModelMeasure("M", new BinaryNode("+",
                new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "7")),
                new AggregateNode("sum", new ColumnNode("d", "OilBbl"), new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "8"))))), Admin)
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidFilter && e.Message == TooManyValues);
    }

    [Fact]
    public void Output_column_name_longer_than_sql_server_allows_is_refused()
    {
        var column = new string('C', 127);
        var catalog = new SchemaCatalog([("core", "WellDaily", column)]);

        var act = () => QueryCompiler.Compile(new DatasetModel([Daily], [], []), new QueryRequest(1, ["d." + column], []), Admin, catalog);

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField && e.Message.Contains("too long"));
    }

    [Fact]
    public void Two_output_columns_with_the_same_name_are_refused()
    {
        var clash = new ModelMeasure("W.WELLNAME", new AggregateNode("count", new ColumnNode("d", "OilBbl")));

        Run(new QueryRequest(1, ["w.WellName"], ["W.WELLNAME"]), QueryCompilerTests.Model(clash))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField && e.Message.Contains("more than once"));
    }

    [Fact]
    public void Identifiers_use_the_catalogue_spelling_not_the_request_casing()
    {
        var result = Compile(new QueryRequest(1, ["W.wellname"], [], [new QueryFilter("d.oilbbl", "is_null")], new QuerySort("w.WELLNAME")));

        result.Sql.Should().StartWith("SELECT TOP (@top) [w].[WellName] AS [w.WellName]")
            .And.Contain("[d].[OilBbl] IS NULL")
            .And.EndWith("ORDER BY [w.WellName]");
        result.Columns.Should().Equal("w.WellName");
    }

    [Fact]
    public void Column_with_two_spellings_in_the_catalogue_is_refused()
    {
        var catalog = new SchemaCatalog([("core", "WellDaily", "OilBbl"), ("core", "WellDaily", "OILBBL")]);

        var act = () => QueryCompiler.Compile(new DatasetModel([Daily], [], []), new QueryRequest(1, ["d.OilBbl"], []), Admin, catalog);

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);
    }

    [Fact]
    public void Empty_request_is_refused()
        => Run(new QueryRequest(1, [], []))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.EmptyRequest);

    [Fact]
    public void Sort_by_a_field_not_in_the_query_is_refused()
        => Run(new QueryRequest(1, ["w.WellName"], [], Sort: new QuerySort("Total Oil")))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);

    // One typed column on core.WellDaily and a measure M that aggregates it.
    private static CompiledQuery CompileTyped(string fn, string column, string? type)
    {
        var catalog = new SchemaCatalog([("core", "WellDaily", column, type)]);
        var measure = new ModelMeasure("M", new AggregateNode(fn, new ColumnNode("d", column)));
        return QueryCompiler.Compile(new DatasetModel([Daily], [], [measure]), new QueryRequest(1, [], ["M"]), Admin, catalog);
    }

    [Theory]
    [InlineData("sum", "WellCode", "varchar", "Sum needs a number column, but d.WellCode holds text.")]
    [InlineData("SUM", "WellCode", "nvarchar(50)", "Sum needs a number column, but d.WellCode holds text.")]
    [InlineData("avg", "ReportDate", "date", "Average needs a number column, but d.ReportDate holds dates.")]
    [InlineData("avg", "ReportDate", "datetime2", "Average needs a number column, but d.ReportDate holds dates.")]
    [InlineData("sum", "IsActive", "bit", "Sum needs a number column, but d.IsActive holds true/false.")]
    public void Sum_and_average_over_a_column_that_is_not_a_number_are_refused(string fn, string column, string type, string message)
        => FluentActions.Invoking(() => CompileTyped(fn, column, type))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure && e.Message == message);

    [Theory]
    [InlineData("sum", "decimal")]
    [InlineData("avg", "int")]
    [InlineData("sum", "Money")]
    [InlineData("sum", null)]
    [InlineData("count", "varchar")]
    [InlineData("count_distinct", "varchar")]
    [InlineData("min", "varchar")]
    [InlineData("max", "date")]
    public void Number_columns_any_type_for_other_aggregates_and_unknown_types_are_accepted(string fn, string? type)
        => CompileTyped(fn, "OilBbl", type).Sql.Should().Contain("[d].[OilBbl]");

    // A binary measure over d.ReportDate (typed by the caller) and OilBbl, both on core.WellDaily.
    private static CompiledQuery CompileDateArithmetic(string op, MeasureNode dateSide, MeasureNode otherSide, string? dateType = "date")
    {
        var catalog = new SchemaCatalog([("core", "WellDaily", "ReportDate", dateType), ("core", "WellDaily", "OilBbl", "decimal")]);
        var measure = new ModelMeasure("M", new BinaryNode(op, dateSide, otherSide));
        return QueryCompiler.Compile(new DatasetModel([Daily], [], [measure]), new QueryRequest(1, [], ["M"]), Admin, catalog);
    }

    [Theory]
    [InlineData("min", "+")]
    [InlineData("min", "-")]
    [InlineData("min", "*")]
    [InlineData("min", "/")]
    [InlineData("max", "+")]
    [InlineData("max", "-")]
    [InlineData("max", "*")]
    [InlineData("max", "/")]
    public void A_min_or_max_of_a_date_cannot_be_used_in_a_calculation(string fn, string op)
        => FluentActions.Invoking(() => CompileDateArithmetic(op, new AggregateNode(fn, new ColumnNode("d", "ReportDate")), new NumberNode(1)))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure
                && e.Message == "M cannot use d.ReportDate in a calculation because it holds a date. Use MIN or MAX of a date on its own.");

    [Fact]
    public void A_date_aggregate_on_either_side_of_the_operator_is_refused()
        => FluentActions.Invoking(() => CompileDateArithmetic("-",
                new AggregateNode("max", new ColumnNode("d", "ReportDate")), new AggregateNode("min", new ColumnNode("d", "ReportDate"))))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure
                && e.Message == "M cannot use d.ReportDate in a calculation because it holds a date. Use MIN or MAX of a date on its own.");

    [Theory]
    [InlineData("datetime")]
    [InlineData("datetime2")]
    [InlineData("smalldatetime")]
    [InlineData("datetimeoffset")]
    public void Every_date_and_time_type_is_refused_in_a_calculation(string type)
        => FluentActions.Invoking(() => CompileDateArithmetic("+", new AggregateNode("min", new ColumnNode("d", "ReportDate")), new NumberNode(1), type))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure);

    [Fact]
    public void Count_of_a_date_column_stays_a_number_and_is_accepted_in_a_calculation()
        => CompileDateArithmetic("+", new AggregateNode("count", new ColumnNode("d", "ReportDate")), new NumberNode(1)).Sql
            .Should().Contain("(COALESCE(COUNT([d].[ReportDate]), 0) + 1)");

    [Fact]
    public void Count_distinct_of_a_date_column_stays_a_number_and_is_accepted_in_a_calculation()
        => CompileDateArithmetic("+", new AggregateNode("count_distinct", new ColumnNode("d", "ReportDate")), new NumberNode(1)).Sql
            .Should().Contain("(COALESCE(COUNT(DISTINCT [d].[ReportDate]), 0) + 1)");

    [Fact]
    public void A_date_column_of_unknown_type_is_accepted_in_a_calculation()
        => CompileDateArithmetic("+", new AggregateNode("max", new ColumnNode("d", "ReportDate")), new NumberNode(1), dateType: null).Sql
            .Should().Contain("(COALESCE(MAX([d].[ReportDate]), 0) + 1)");

    [Fact]
    public void A_lone_min_or_max_of_a_date_stays_a_valid_measure()
        => CompileTyped("max", "OilBbl", "date").Sql.Should().Contain("MAX([d].[OilBbl])");

    private static DatasetModel WithCondition(string fn, string source, string column, string conditionSource, string conditionColumn, string op, string value)
        => QueryCompilerTests.Model(new ModelMeasure("M", new AggregateNode(fn, new ColumnNode(source, column),
            new MeasureCondition(new ColumnNode(conditionSource, conditionColumn), op, value))));

    [Fact]
    public void A_condition_on_another_source_is_refused()
        => Run(new QueryRequest(1, [], ["M"]), WithCondition("sum", "d", "OilBbl", "w", "WellName", "eq", "North 1"))
            .Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.InvalidMeasure && e.Message == "The condition in M must use a column of d, the table it calculates over.");

    [Fact]
    public void An_unknown_comparison_is_refused()
        => Run(new QueryRequest(1, [], ["M"]), WithCondition("sum", "d", "OilBbl", "d", "WellId", "like", "7"))
            .Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.InvalidMeasure && e.Message == "M uses an unknown comparison \"like\".");

    [Fact]
    public void A_condition_on_an_unknown_column_is_refused()
        => Run(new QueryRequest(1, [], ["M"]), WithCondition("sum", "d", "OilBbl", "d", "NoSuch", "eq", "7"))
            .Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.UnknownField && e.Message == "d has no column called \"NoSuch\".");

    [Fact]
    public void Condition_values_never_reach_the_sql_text()
    {
        const string hostile = "x'; DROP TABLE core.Well; --";

        var result = Compile(new QueryRequest(1, [], ["M"]), model: WithCondition("count", "d", "OilBbl", "d", "WellId", "eq", hostile));

        result.Sql.Should().NotContain("DROP").And.NotContain("--");
        result.Parameters["@p0"].Should().Be(hostile);
    }

    [Fact]
    public void A_condition_does_not_hide_a_fan_trap()
        => Run(new QueryRequest(1, ["d.ReportDate"], ["M"]), WithCondition("sum", "w", "Capacity", "w", "WellName", "neq", "Test"))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.FanTrap);

    // core.WellDaily with typed columns, and a measure M that counts OilBbl on the rows where column equals value.
    private static CompiledQuery CompileCondition(string column, string? type, string value)
    {
        var catalog = new SchemaCatalog([("core", "WellDaily", "OilBbl", "decimal"), ("core", "WellDaily", column, type)]);
        var measure = new ModelMeasure("M", new AggregateNode("count", new ColumnNode("d", "OilBbl"),
            new MeasureCondition(new ColumnNode("d", column), "eq", value)));
        return QueryCompiler.Compile(new DatasetModel([Daily], [], [measure]), new QueryRequest(1, [], ["M"]), Admin, catalog);
    }

    [Theory]
    [InlineData("WellId", "int", "abc", "M compares d.WellId, which holds numbers, with \"abc\". Use a number.")]
    [InlineData("WellId", "decimal(18,2)", "1,5", "M compares d.WellId, which holds numbers, with \"1,5\". Use a number.")]
    [InlineData("ReportDate", "date", "yesterday", "M compares d.ReportDate, which holds dates, with \"yesterday\". Use a date written as 2026-01-31.")]
    public void Condition_values_that_do_not_fit_the_column_are_refused(string column, string type, string value, string message)
        => FluentActions.Invoking(() => CompileCondition(column, type, value))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure && e.Message == message);

    [Theory]
    [InlineData("01/02/2026")]
    [InlineData("2026-01-31T00:00:00Z")]
    [InlineData("2026-01-31T00:00:00+06:00")]
    [InlineData("10:30")]
    [InlineData("31 Jan")]
    [InlineData("2026-01-31 ")]
    [InlineData("2026-02-30")]
    public void Date_values_in_any_other_form_are_refused(string value)
        => FluentActions.Invoking(() => CompileCondition("ReportDate", "date", value))
            .Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidMeasure
                && e.Message == $"M compares d.ReportDate, which holds dates, with \"{value}\". Use a date written as 2026-01-31.");

    public static TheoryData<string, DateTime> DateForms => new()
    {
        { "2026-01-31", new DateTime(2026, 1, 31) },
        { "2026-01-31T10:30:15", new DateTime(2026, 1, 31, 10, 30, 15) },
        { "2026-01-31 10:30:15", new DateTime(2026, 1, 31, 10, 30, 15) },
        { "2026-01-31T23:59:59.999", new DateTime(2026, 1, 31, 23, 59, 59, 999) },
        { "2026-01-31T23:59:59.1234567", new DateTime(2026, 1, 31, 23, 59, 59).AddTicks(1234567) },
        { "1700-01-01", new DateTime(1700, 1, 1) },
        { "0001-01-01", DateTime.MinValue },
    };

    [Theory]
    [MemberData(nameof(DateForms))]
    public void Date_values_in_the_iso_forms_are_accepted(string value, DateTime expected)
        => CompileCondition("ReportDate", "datetime2", value).Parameters["@p0"].Should().Be(expected);

    public static TheoryData<string, string?, string, object> TypedValues => new()
    {
        { "WellId", "int", "7", 7m },
        { "WellId", "decimal", "-2.5", -2.5m },
        { "ReportDate", "datetime2", "2026-01-31", new DateTime(2026, 1, 31) },
        { "Shift", "varchar", "Night", "Night" },
        { "WellId", null, "7", "7" },
    };

    [Theory]
    [MemberData(nameof(TypedValues))]
    public void Condition_values_are_passed_as_the_columns_type(string column, string? type, string value, object expected)
        => CompileCondition(column, type, value).Parameters["@p0"].Should().Be(expected);
}
