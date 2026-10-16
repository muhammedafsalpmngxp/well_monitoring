using System.Globalization;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class DatasetRulesTests
{
    [Fact]
    public void Stored_measure_reads_back_and_unreadable_json_gives_null()
    {
        DatasetRules.ReadMeasure("""{"kind":"agg","fn":"count","arg":{"source":"t","column":"task_daily_id"}}""")
            .Should().Be(new AggregateNode("count", new ColumnNode("t", "task_daily_id")));
        DatasetRules.ReadMeasure("{}").Should().BeNull();
        DatasetRules.ReadMeasure("not json").Should().BeNull();
    }

    [Fact]
    public void New_source_takes_the_catalogue_spelling_of_table_and_plant_column()
    {
        var result = DatasetRules.NewSource(1, new AddSourceRequest("CORE", "taskdaily", "Tasks", "plant", "CREW_TYPE_ID"), Columns, []);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeEquivalentTo(new
        {
            DatasetId = 1L, SourceKind = "table", SchemaName = "core", SourceName = "TaskDaily",
            Alias = "Tasks", RlsMode = "plant", RlsPlantColumn = "crew_type_id",
        });
    }

    [Fact]
    public void Table_missing_from_the_catalogue_is_refused()
        => DatasetRules.NewSource(1, new AddSourceRequest("core", "NoSuchTable", "x", "none", null), Columns, [])
            .IsValidationError.Should().BeTrue();

    [Fact]
    public void Alias_already_used_in_the_dataset_is_a_conflict()
        => DatasetRules.NewSource(1, new AddSourceRequest("ref", "CrewType", "taskdaily", "none", null), Columns, [Tasks()])
            .IsConflict.Should().BeTrue();

    [Fact]
    public void Plant_filter_needs_a_column_the_table_has()
        => DatasetRules.NewSource(1, new AddSourceRequest("core", "TaskDaily", "Tasks", "plant", "PlantCode"), Columns, [])
            .IsValidationError.Should().BeTrue();

    [Fact]
    public void Choosing_no_filter_clears_the_plant_column()
    {
        var source = Crews();
        source.RlsMode = "plant";
        source.RlsPlantColumn = "code";

        var result = DatasetRules.ApplyRls(source, "none", "code", Columns);

        result.Value!.RlsMode.Should().Be("none");
        result.Value.RlsPlantColumn.Should().BeNull();
    }

    private static readonly AddRelationshipRequest TaskToCrew = new(1, "CREW_TYPE_ID", 2, "Crew_Type_Id", "many_to_one", "user");

    [Fact]
    public void Relationship_stores_the_catalogue_spelling_of_both_columns()
        => DatasetRules.NewRelationship(1, TaskToCrew, [Tasks(), Crews()], Columns, []).Value.Should().BeEquivalentTo(new
        {
            DatasetId = 1L, FromSourceId = 1L, FromColumn = "crew_type_id", ToSourceId = 2L, ToColumn = "crew_type_id",
            Cardinality = "many_to_one", IsActive = true, DetectedFrom = "user",
        });

    [Fact]
    public void Relationship_column_must_exist_on_its_table()
        => DatasetRules.NewRelationship(1, TaskToCrew with { ToColumn = "task_code" }, [Tasks(), Crews()], Columns, [])
            .ErrorMessage.Should().Be("CrewType has no column called \"task_code\".");

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void The_same_join_in_either_direction_is_a_conflict(bool reversed)
    {
        var request = reversed ? new AddRelationshipRequest(2, "crew_type_id", 1, "crew_type_id", "many_to_one", "user") : TaskToCrew;

        DatasetRules.NewRelationship(1, request, [Tasks(), Crews()], Columns, [TasksToCrews()]).IsConflict.Should().BeTrue();
    }

    [Fact]
    public void Both_tables_must_belong_to_the_dataset()
        => DatasetRules.NewRelationship(1, TaskToCrew with { ToSourceId = 99 }, [Tasks(), Crews()], Columns, [])
            .IsValidationError.Should().BeTrue();

    [Fact]
    public void Foreign_keys_between_the_datasets_tables_are_suggested_as_many_to_one()
        => DatasetRules.SuggestRelationships([Tasks(), Crews()], Columns, []).Should().Equal(
            new RelationshipSuggestionDto(1, "crew_type_id", 2, "crew_type_id", "many_to_one"));

    [Fact]
    public void Suggestions_already_added_are_left_out()
        => DatasetRules.SuggestRelationships([Tasks(), Crews()], Columns, [TasksToCrews()]).Should().BeEmpty();

    [Fact]
    public void Valid_measure_is_returned_as_normalised_json()
        => DatasetRules.CheckMeasure(1, "Task Count", TaskCount, [Tasks(), Crews()], [TasksToCrews()], Columns).Value
            .Should().Be("""{"kind":"agg","fn":"count","arg":{"source":"TaskDaily","column":"task_daily_id"}}""");

    [Fact]
    public void Measure_over_a_missing_column_is_refused_with_the_compilers_message()
        => DatasetRules.CheckMeasure(1, "Hours", new AggregateNode("sum", new ColumnNode("TaskDaily", "hours")), [Tasks()], [], Columns)
            .ErrorMessage.Should().Be("TaskDaily has no column called \"hours\".");

    [Fact]
    public void Measure_across_unrelated_tables_is_refused()
    {
        var ratio = new BinaryNode("/", TaskCount, new AggregateNode("count", new ColumnNode("CrewType", "crew_type_id")));

        DatasetRules.CheckMeasure(1, "Tasks per crew", ratio, [Tasks(), Crews()], [], Columns)
            .ErrorMessage.Should().Contain("are not related");
    }

    private static readonly MeasureNode Hours = new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours"));

    [Theory]
    [InlineData("123456789012345")]
    [InlineData("0.000001")]
    [InlineData("-99999999.999999")]
    public void Measure_with_numbers_inside_the_formula_limits_is_accepted(string number)
        => DatasetRules.CheckMeasure(1, "Scaled", new BinaryNode("*", Hours, new NumberNode(decimal.Parse(number, CultureInfo.InvariantCulture))),
            [Tasks()], [], Columns).IsSuccess.Should().BeTrue();

    [Theory]
    [InlineData("1234567890123456")]
    [InlineData("1.1234567")]
    [InlineData("-0.0000001")]
    [InlineData("99999999.9999999")]
    public void Measure_with_a_number_the_formula_text_cannot_hold_is_refused(string number)
    {
        var result = DatasetRules.CheckMeasure(1, "Scaled",
            new BinaryNode("*", Hours, new NumberNode(decimal.Parse(number, CultureInfo.InvariantCulture))), [Tasks()], [], Columns);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be($"Scaled uses the number {number}. A number can have at most 15 digits, and at most 6 after the decimal point.");
    }

    [Fact]
    public void Measure_whose_formula_text_is_too_long_is_refused()
    {
        // Each term prints as "SUM(TaskDaily.data_hours)" and a " + " joins them: 80 terms are 2,237 characters.
        var measure = Enumerable.Range(0, 79).Aggregate(Hours, (sum, _) => new BinaryNode("+", sum, Hours));

        var result = DatasetRules.CheckMeasure(1, "Long", measure, [Tasks()], [], Columns);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("The formula of Long is 2237 characters long. A formula can be at most 2000 characters long.");
    }

    [Fact]
    public void Measure_without_an_aggregate_is_refused()
        => DatasetRules.CheckMeasure(1, "Bare", new ColumnNode("TaskDaily", "data_hours"), [Tasks()], [], Columns)
            .IsValidationError.Should().BeTrue();

    [Fact]
    public void Measure_that_calculates_with_a_date_is_refused()
    {
        var typed = Columns.Select(c => c.Column == "data_hours" ? c with { DataType = "date" } : c).ToList();
        var measure = new BinaryNode("+", new AggregateNode("max", new ColumnNode("TaskDaily", "data_hours")), new NumberNode(1));

        var result = DatasetRules.CheckMeasure(1, "Scaled", measure, [Tasks()], [], typed);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be(
            "Scaled cannot use TaskDaily.data_hours in a calculation because it holds a date. Use MIN or MAX of a date on its own.");
    }

    [Fact]
    public void First_broken_measure_gives_its_name_and_the_compilers_reason_and_skips_unreadable_ones()
    {
        var unreadable = new DatasetMeasure { Id = 4, DatasetId = 1, Name = "Unreadable", ExpressionAst = "{}" };
        var ratio = Measure(6, "Tasks per crew",
            new BinaryNode("/", TaskCount, new AggregateNode("count", new ColumnNode("CrewType", "crew_type_id"))));

        DatasetRules.FirstBrokenMeasure([Tasks(), Crews()], [], Columns, [unreadable, Measure(5, "Task Count", TaskCount), ratio])
            .Should().Be(("Tasks per crew", "TaskDaily and CrewType are not related. Add a relationship?"));
    }

    [Fact]
    public void No_broken_measure_gives_null()
        => DatasetRules.FirstBrokenMeasure([Tasks()], [], Columns, [Measure(5, "Task Count", TaskCount)]).Should().BeNull();

    [Fact]
    public void Row_filter_mode_is_case_sensitive()
        => DatasetRules.ApplyRls(Crews(), "Plant", "code", Columns).IsValidationError.Should().BeTrue();

    private static readonly MeasureNode Minutes = new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(60));

    [Fact]
    public void New_calculated_column_carries_its_tree_its_text_and_its_type()
    {
        var result = DatasetRules.NewCalculatedColumn(1, Tasks(), "Minutes", Minutes, Parts(Tasks()), Columns);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeEquivalentTo(new
        {
            DatasetId = 1L, SourceId = 1L, Name = "Minutes", ExpressionAst = Json(Minutes),
            ExpressionText = "TaskDaily.data_hours * 60", DataType = "number",
        });
    }

    [Fact]
    public void A_text_formula_gives_a_text_column()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "Family",
                new FunctionNode("left", [new ColumnNode("TaskDaily", "task_code"), new NumberNode(4)]), Parts(Tasks()), Columns)
            .Value!.DataType.Should().Be("text");

    [Fact]
    public void A_calculated_column_cannot_take_the_name_of_a_table_column()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "TASK_CODE", Minutes, Parts(Tasks()), Columns)
            .ErrorMessage.Should().Be("TaskDaily already has a column called \"task_code\". Choose another name.");

    [Fact]
    public void A_calculated_column_name_is_unique_per_table_in_any_case()
    {
        var result = DatasetRules.NewCalculatedColumn(1, Tasks(), "minutes", Minutes, Parts(Tasks(), Calculated(20, "Minutes", Minutes)), Columns);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be("TaskDaily already has a calculated column called \"minutes\".");
    }

    [Fact]
    public void A_calculated_column_the_compiler_refuses_is_refused_with_its_message()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "Total", new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours")),
                Parts(Tasks()), Columns)
            .ErrorMessage.Should().Be(
                "TaskDaily.Total uses SUM, which adds up many rows. A calculated column works on one row at a time; build a measure instead.");

    [Fact]
    public void A_calculated_column_keeps_the_formula_limits_of_measures()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "Scaled",
                new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(1.1234567m)), Parts(Tasks()), Columns)
            .ErrorMessage.Should().Be("Scaled uses the number 1.1234567. A number can have at most 15 digits, and at most 6 after the decimal point.");

    [Fact]
    public void New_transform_takes_the_catalogue_spelling_and_goes_last()
    {
        var result = DatasetRules.NewTransform(1, Tasks(), new AddTransformRequest(1, "TASK_CODE", "null_fill", "none"),
            Parts(Tasks(), Transform(30, "task_code", "trim", sortOrder: 4)), Columns);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeEquivalentTo(new
        {
            DatasetId = 1L, SourceId = 1L, ColumnName = "task_code", Kind = "null_fill", ConfigJson = """{"value":"none"}""", SortOrder = 5,
        });
    }

    [Fact]
    public void A_trim_has_an_empty_configuration_and_comes_first_on_a_table_without_transforms()
        => DatasetRules.NewTransform(1, Tasks(), new AddTransformRequest(1, "task_code", "trim", null), Parts(Tasks()), Columns)
            .Value.Should().BeEquivalentTo(new { ConfigJson = "{}", SortOrder = 1 });

    [Fact]
    public void The_plant_column_cannot_have_a_transform()
    {
        var crews = Crews();
        crews.RlsMode = "plant";
        crews.RlsPlantColumn = "code";

        DatasetRules.NewTransform(1, crews, new AddTransformRequest(2, "code", "trim", null), Parts(crews), Columns)
            .ErrorMessage.Should().Be("CrewType.code decides who sees which rows, so a transform cannot change it.");
    }

    [Fact]
    public void A_calculated_column_cannot_have_a_transform()
        => DatasetRules.NewTransform(1, Tasks(), new AddTransformRequest(1, "Minutes", "trim", null),
                Parts(Tasks(), Calculated(20, "Minutes", Minutes)), Columns)
            .ErrorMessage.Should().Be("TaskDaily.Minutes is a calculated column. Change its formula instead of adding a transform.");

    [Fact]
    public void A_transform_the_compiler_refuses_is_refused_with_its_message()
    {
        var typed = Columns.Select(c => c.Column == "data_hours" ? c with { DataType = "decimal" } : c).ToList();

        DatasetRules.NewTransform(1, Tasks(), new AddTransformRequest(1, "data_hours", "trim", null), Parts(Tasks()), typed)
            .ErrorMessage.Should().Be("Trim works on text, but TaskDaily.data_hours holds numbers.");
    }

    [Fact]
    public void First_broken_column_is_found_and_unreadable_ones_are_skipped()
    {
        var unreadable = new DatasetCalculatedColumn { Id = 21, DatasetId = 1, SourceId = 1, Name = "Unreadable", ExpressionAst = "{}", DataType = "number" };
        var working = Calculated(20, "Minutes", Minutes);
        var broken = Calculated(22, "Hours per crew",
            new BinaryNode("/", new ColumnNode("TaskDaily", "data_hours"), new ColumnNode("CrewType", "employee_count")));

        DatasetRules.FirstBrokenColumn(Parts(Tasks(), Crews(), unreadable, working, broken), Columns, [unreadable, working, broken])
            .Should().BeSameAs(broken);
    }

    [Fact]
    public void A_replace_stores_what_it_finds_and_what_replaces_it()
        => DatasetRules.NewTransform(1, Tasks(), new AddTransformRequest(1, "task_code", "replace", "-",
                new Dictionary<string, string> { ["with"] = "", ["match"] = "part" }), Parts(Tasks()), Columns)
            .Value.Should().BeEquivalentTo(new { Kind = "replace", ConfigJson = """{"value":"-","with":"","match":"part"}""", SortOrder = 1 });

    [Fact]
    public void A_removal_of_blank_rows_stores_no_value()
        => DatasetRules.NewTransform(1, Tasks(), new AddTransformRequest(1, "task_assignee", "remove_rows", null,
                new Dictionary<string, string> { ["op"] = "blank" }), Parts(Tasks()), Columns)
            .Value!.ConfigJson.Should().Be("""{"value":null,"op":"blank"}""");

    [Fact]
    public void Transform_options_reach_the_compiler_and_the_client()
    {
        var stored = new DatasetTransform
        {
            Id = 31, DatasetId = 1, SourceId = 1, ColumnName = "task_code", Kind = "replace",
            ConfigJson = """{"value":"-","with":"","match":"part"}""", SortOrder = 1,
        };
        var parts = Parts(Tasks(), stored);
        var expected = new Dictionary<string, string> { ["with"] = "", ["match"] = "part" };

        DatasetRules.ToModel(parts, []).Transforms!.Single().Should().BeEquivalentTo(new { Kind = "replace", Value = "-", Options = expected });
        DatasetDetailDto.From(NewDataset(), parts).Transforms.Single().Options.Should().BeEquivalentTo(expected);
    }

    [Fact]
    public void A_date_formula_gives_a_date_column()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "Month",
                new FunctionNode("month_start", [new ColumnNode("TaskDaily", "task_code")]), Parts(Tasks()), Columns)
            .Value!.DataType.Should().Be("date");

    [Fact]
    public void An_if_between_two_text_columns_gives_a_text_column()
    {
        var typed = Columns.Select(c => c.Column switch
        {
            "task_code" or "task_assignee" => c with { DataType = "nvarchar" },
            "data_hours" => c with { DataType = "decimal" },
            _ => c,
        }).ToList();
        var pick = new FunctionNode("if", [
            new CompareNode("gt", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(0)),
            new ColumnNode("TaskDaily", "task_code"), new ColumnNode("TaskDaily", "task_assignee"),
        ]);

        DatasetRules.NewCalculatedColumn(1, Tasks(), "Label", pick, Parts(Tasks()), typed).Value!.DataType.Should().Be("text");
    }

    [Fact]
    public void A_number_in_a_comparison_keeps_the_formula_limits()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "Flag",
                new FunctionNode("if", [
                    new CompareNode("gt", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(1.1234567m)), new NumberNode(1), new NumberNode(0),
                ]), Parts(Tasks()), Columns)
            .ErrorMessage.Should().Be("Flag uses the number 1.1234567. A number can have at most 15 digits, and at most 6 after the decimal point.");

    [Fact]
    public void A_calculated_column_reads_the_type_its_columns_have_after_their_transforms()
    {
        var typed = Columns.Select(c => c.Column == "task_code" ? c with { DataType = "nvarchar" } : c).ToList();

        DatasetRules.NewCalculatedColumn(1, Tasks(), "Code Or Zero",
                new FunctionNode("coalesce", [new ColumnNode("TaskDaily", "task_code"), new NumberNode(0)]),
                Parts(Tasks(), Transform(30, "task_code", "type", "number")), typed)
            .Value!.DataType.Should().Be("number");
    }

    // The length is checked before the formula is compiled, so a long formula is never expanded.
    [Fact]
    public void A_calculated_column_longer_than_the_formula_limit_is_refused_before_it_is_compiled()
    {
        MeasureNode formula = new ColumnNode("TaskDaily", "no_such_column");
        for (var i = 0; i < 150; i++) formula = new BinaryNode("+", formula, new ColumnNode("TaskDaily", "no_such_column"));

        DatasetRules.NewCalculatedColumn(1, Tasks(), "Long", formula, Parts(Tasks()), Columns)
            .ErrorMessage.Should().StartWith("The formula of Long is ").And.EndWith(" characters long. A formula can be at most 2000 characters long.");
    }

    [Fact]
    public void A_calculated_column_that_reads_other_rows_is_refused()
        => DatasetRules.NewCalculatedColumn(1, Tasks(), "Share",
                new FunctionNode("percent_of_total", [new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours"))]), Parts(Tasks()), Columns)
            .ErrorMessage.Should().Be(
                "TaskDaily.Share uses PERCENT_OF_TOTAL, which compares a row with other rows. A calculated column works on one row at a time; use PERCENT_OF_TOTAL in a measure instead.");

    private static DatabaseConnection Server(long id, string database, string server = "20.98.112.250", int port = 1433) => new()
        { Id = id, TenantId = TenantId, ConnectionName = database, DatabaseName = database, Server = server, Port = port, Provider = "mssql" };

    [Fact]
    public void A_table_of_another_database_on_the_same_server_can_be_joined()
    {
        DatasetRules.CannotJoin(Server(4, "smartops_tenant_TNT-1000"), Server(5, "AlTasnimBI", " 20.98.112.250 ")).Should().BeNull();
        DatasetRules.CannotJoin(Server(4, "smartops_tenant_TNT-1000"), Server(4, "smartops_tenant_TNT-1000")).Should().BeNull();
    }

    [Fact]
    public void A_database_on_another_server_or_port_is_refused_naming_both_servers()
    {
        DatasetRules.CannotJoin(Server(4, "smartops_tenant_TNT-1000"), Server(5, "Sales", "10.0.0.9")).Should().Be(
            "Sales is on 10.0.0.9,1433 and this data model reads smartops_tenant_TNT-1000 on 20.98.112.250,1433. " +
            "Tables of two databases can be joined only when both are on the same server.");
        DatasetRules.CannotJoin(Server(4, "smartops_tenant_TNT-1000"), Server(5, "Sales", port: 1434)).Should().Contain("20.98.112.250,1434");
    }

    [Fact]
    public void A_connection_that_is_not_active_sql_server_is_refused()
    {
        var postgres = Server(5, "Sales");
        postgres.Provider = "postgres";
        var inactive = Server(6, "Old");
        inactive.IsActive = false;

        DatasetRules.CannotJoin(Server(4, "t"), postgres).Should().Be("Sales is not an active SQL Server connection.");
        DatasetRules.CannotJoin(Server(4, "t"), inactive).Should().Be("Old is not an active SQL Server connection.");
    }

    [Fact]
    public void A_table_of_another_database_keeps_its_connection_and_may_not_share_a_name_with_another_databases_table()
    {
        var result = DatasetRules.NewSource(1, new AddSourceRequest("ref", "CrewType", "Crews", "none", null), Columns, [Tasks()], 10005);
        result.Value!.ConnectionId.Should().Be(10005);

        DatasetRules.NewSource(1, new AddSourceRequest("core", "TaskDaily", "Tasks2", "none", null), Columns, [Tasks()], 10005)
            .ErrorMessage.Should().Be("This data model already reads a table called core.TaskDaily from another database. A data model can hold a table name from one database only.");
        // The same table twice from one database stays allowed, as before.
        DatasetRules.NewSource(1, new AddSourceRequest("core", "TaskDaily", "Tasks2", "none", null), Columns, [Tasks()]).IsSuccess.Should().BeTrue();
    }
}
