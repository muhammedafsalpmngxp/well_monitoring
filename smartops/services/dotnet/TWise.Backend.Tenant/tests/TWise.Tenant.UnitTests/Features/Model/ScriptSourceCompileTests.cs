using System.Text.RegularExpressions;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using static TWise.Tenant.UnitTests.Features.Model.QueryCompilerTests;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ScriptSourceCompileTests
{
    private const string Batch = """
        DECLARE @start DATE = '2026-01-01'; -- the first day
        DECLARE @plant NVARCHAR(100) = NULL;
        ;WITH w AS (SELECT p.plant, p.qty FROM dbo.prod AS p WHERE p.day >= @start AND (@plant IS NULL OR p.plant = @plant))
        SELECT w.plant AS Plant, SUM(w.qty) AS Value FROM w GROUP BY w.plant ORDER BY Value DESC;
        """;

    private static ScriptSql Script(IReadOnlyDictionary<string, string>? bindings = null) => new(
        Batch, [new ViewColumn("Plant", "nvarchar(100)"), new ViewColumn("Value", "int")],
        bindings ?? new Dictionary<string, string> { ["@plant"] = "Plant.plant_description" }, "Production");

    private static ModelSource Prod(ScriptSql? script = null) => new(1, "Prod", "script", "7", "none", null, Script: script ?? Script());

    private static readonly ModelSource Plant = new(2, "Plant", "dbo", "plant_description", "none", null);

    private static readonly SchemaCatalog Columns = new([
        ("script", "7", "row_order", "int"), ("script", "7", "Plant", "nvarchar(100)"), ("script", "7", "Value", "int"),
        ("dbo", "plant_description", "plant_description", "nvarchar(100)"),
    ]);

    private static readonly ModelMeasure Total = new("Total", new AggregateNode("sum", new ColumnNode("Prod", "Value")));

    private static CompiledQuery Run(ModelSource prod, params QueryFilter[] filters)
        => QueryCompiler.Compile(new DatasetModel([prod, Plant], [], [Total]), new QueryRequest(1, ["Prod.Plant"], ["Total"], filters), Admin, Columns);

    [Fact]
    public void A_script_source_runs_its_batch_into_a_temporary_table_that_the_query_reads()
    {
        var sql = Run(Prod()).Sql;

        sql.Should().StartWith("SET NOCOUNT ON;\n");
        sql.Should().Contain("CREATE TABLE #s0 ([row_order] int IDENTITY(1,1), [Plant] nvarchar(100) COLLATE DATABASE_DEFAULT, [Value] int);");
        // The view's own WITH and ORDER BY stay around the INSERT, so row_order follows the view's order.
        sql.Should().MatchRegex(@"WITH w\s+AS[\s\S]*INSERT INTO #s0 \(\[Plant\], \[Value\]\)[\s\S]*ORDER BY Value DESC;");
        sql.Should().EndWith("SELECT TOP (@top) [Prod].[Plant] AS [Prod.Plant], SUM([Prod].[Value]) AS [Total]\nFROM #s0 AS [Prod]\nGROUP BY [Prod].[Plant]");
        sql.Should().NotContain("-- the first day");
    }

    [Fact]
    public void Without_a_filter_the_view_keeps_its_own_defaults_under_names_of_its_own()
    {
        var result = Run(Prod());

        result.Sql.Should().MatchRegex(@"DECLARE @s0_start AS DATE = '2026-01-01';").And.MatchRegex(@"DECLARE @s0_plant AS NVARCHAR \(100\) = NULL;");
        result.Sql.Should().Contain("p.plant = @s0_plant").And.NotContain("@plant ");
        result.Parameters.Keys.Should().Equal("@top");
    }

    [Fact]
    public void A_filter_on_the_bound_field_sets_the_variable_and_filters_no_rows()
    {
        var result = Run(Prod(), new QueryFilter("plant.PLANT_DESCRIPTION", "in", ["Nimr"]));

        result.Sql.Should().MatchRegex(@"DECLARE @s0_plant AS NVARCHAR \(100\) = @p0;");
        // The query after the batch filters nothing and joins nothing.
        result.Sql[(result.Sql.LastIndexOf(';') + 1)..].Should().NotContain("WHERE").And.NotContain("[Plant].");
        result.Parameters.Should().Equal(new Dictionary<string, object> { ["@p0"] = "Nimr", ["@top"] = QueryCompiler.DefaultTopN });
    }

    [Fact]
    public void An_eq_filter_on_the_bound_field_sets_the_variable_too()
        => Run(Prod(), new QueryFilter("Plant.plant_description", "eq", ["Nimr"])).Parameters["@p0"].Should().Be("Nimr");

    [Fact]
    public void A_range_on_the_field_sets_a_variable_bound_to_its_from_end_and_a_value_list_does_not()
    {
        var bindings = new Dictionary<string, string> { ["@start"] = "Plant.plant_description" + ScriptSource.FromEnd, ["@plant"] = "Plant.plant_description" };

        var range = Run(Prod(Script(bindings)), new QueryFilter("Plant.plant_description", "between", ["2026-03-01", "2026-06-30"]));
        range.Sql.Should().MatchRegex(@"DECLARE @s0_start AS DATE = @p0;").And.MatchRegex(@"DECLARE @s0_plant AS NVARCHAR \(100\) = NULL;");
        range.Parameters["@p0"].Should().Be("2026-03-01");

        Run(Prod(Script(bindings)), new QueryFilter("Plant.plant_description", "gte", ["2026-04-01"])).Parameters["@p0"].Should().Be("2026-04-01");
        Run(Prod(Script(bindings)), new QueryFilter("Plant.plant_description", "in", ["Nimr"])).Sql
            .Should().MatchRegex(@"DECLARE @s0_start AS DATE = '2026-01-01';").And.MatchRegex(@"DECLARE @s0_plant AS NVARCHAR \(100\) = @p0;");
    }

    [Fact]
    public void A_binding_names_the_end_of_a_range_it_takes()
    {
        ScriptSource.RangeEnd("WP.period_start:from").Should().Be(("WP.period_start", ScriptSource.FromEnd));
        ScriptSource.RangeEnd("WP.period_start:TO").Should().Be(("WP.period_start", ScriptSource.ToEnd));
        ScriptSource.RangeEnd("WP.period_start").Should().Be(("WP.period_start", (string?)null));
    }

    [Fact]
    public void Two_values_for_a_bound_field_are_refused()
    {
        var act = () => Run(Prod(), new QueryFilter("Plant.plant_description", "in", ["Nimr", "Marmul"]));

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.InvalidFilter)
            .WithMessage("Choose one value for Plant.plant_description; the view Production takes one.");
    }

    [Fact]
    public void A_filter_on_an_unrelated_field_that_no_variable_takes_is_skipped_as_the_dashboard_does()
    {
        var result = Run(Prod(Script(new Dictionary<string, string>())), new QueryFilter("Plant.plant_description", "in", ["Nimr"]));

        result.Sql[(result.Sql.LastIndexOf(';') + 1)..].Should().NotContain("WHERE").And.NotContain("[Plant].");
        result.Parameters.Keys.Should().Equal("@top");
        result.SkippedFilters.Should().Equal("Plant.plant_description");
    }

    [Fact]
    public void A_bound_filter_on_a_table_the_query_also_reads_sets_the_variable_and_still_filters_its_rows()
    {
        var model = new DatasetModel([Prod(), Plant], [new ModelRelationship(10, 1, "Plant", 2, "plant_description", "many_to_one")], [Total]);

        var result = QueryCompiler.Compile(model,
            new QueryRequest(1, ["Plant.plant_description"], ["Total"], [new QueryFilter("Plant.plant_description", "in", ["Nimr"])]), Admin, Columns);

        result.Sql.Should().MatchRegex(@"DECLARE @s0_plant AS NVARCHAR \(100\) = @p1;").And.Contain("WHERE [Plant].[plant_description] IN (@p0)");
        result.SkippedFilters.Should().BeEmpty();
    }

    [Fact]
    public void A_stored_batch_that_no_longer_passes_the_checks_is_refused_when_it_runs()
    {
        var act = () => Run(Prod(Script() with { Batch = "SELECT d.name AS Plant, 1 AS Value FROM sys.databases AS d" }));

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.SourceNotContractCompliant).WithMessage("*system schema*");
    }

    [Fact]
    public void A_rowversion_column_is_kept_as_eight_bytes_in_the_temporary_table()
        => Run(Prod(Script() with { Columns = [new ViewColumn("Plant", "nvarchar(100)"), new ViewColumn("Value", "int"), new ViewColumn("Stamp", "timestamp")] }))
            .Sql.Should().Contain("[Value] int, [Stamp] binary(8));");

    [Fact]
    public void A_query_that_also_reads_a_table_still_refuses_an_unrelated_filter()
    {
        var model = new DatasetModel([Prod(Script(new Dictionary<string, string>())), Plant], [], [Total]);
        var act = () => QueryCompiler.Compile(model,
            new QueryRequest(1, ["Plant.plant_description"], ["Total"], [new QueryFilter("Plant.plant_description", "in", ["Nimr"])]), Admin, Columns);

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.MissingRelationship);
    }

    [Fact]
    public void A_filter_on_the_script_sources_own_column_filters_its_rows()
        => Run(Prod(), new QueryFilter("Prod.Plant", "in", ["Nimr"])).Sql.Should().Contain("WHERE [Prod].[Plant] IN (@p0)");

    [Fact]
    public void Calculated_columns_are_read_through_a_cte_over_the_temporary_table()
    {
        var model = new DatasetModel([Prod(), Plant], [], [Total],
            [new ModelCalculatedColumn(1, "Double", new BinaryNode("*", new ColumnNode("Prod", "Value"), new NumberNode(2)))]);

        var sql = QueryCompiler.Compile(model, new QueryRequest(1, ["Prod.Double"], []), Admin, Columns).Sql;

        sql.Should().Contain("WITH [Prod] AS (SELECT ([Value] * 2) AS [Double] FROM #s0)\nSELECT TOP (@top) [Prod].[Double]");
    }

    [Fact]
    public void The_row_order_can_be_read_like_any_column()
        => QueryCompiler.Compile(new DatasetModel([Prod()], [], []), new QueryRequest(1, ["Prod.row_order", "Prod.Plant"], []), Admin, Columns)
            .Sql.Should().EndWith("SELECT TOP (@top) [Prod].[row_order] AS [Prod.row_order], [Prod].[Plant] AS [Prod.Plant]\nFROM #s0 AS [Prod]\nGROUP BY [Prod].[row_order], [Prod].[Plant]");

    [Fact]
    public void A_sample_of_a_script_source_runs_the_batch_with_its_defaults_in_the_views_order()
    {
        var result = QueryCompiler.Sample(Prod() with { Alias = "t" }, ["row_order", "Plant", "Value"], Columns, 50);

        result.Sql.Should().StartWith("SET NOCOUNT ON;\n").And.Contain("CREATE TABLE #s0")
            .And.EndWith("SELECT TOP (@top) [row_order], [Plant], [Value]\nFROM #s0 AS [t]\nORDER BY [row_order]");
        result.Parameters.Keys.Should().Equal("@top");
    }

    [Fact]
    public void The_saved_view_10117_compiles_into_one_batch_with_its_plant_bound()
    {
        var script = new ScriptSql(ScriptSourceTests.View10117(),
            [new ViewColumn("Period", "varchar(20)"), new ViewColumn("Category", "varchar(40)"), new ViewColumn("Value", "int")],
            new Dictionary<string, string> { ["@plant"] = "Plant.plant_description" }, "Well delivery");
        var catalog = new SchemaCatalog([
            ("script", "10117", "row_order", "int"), ("script", "10117", "Period", "varchar(20)"), ("script", "10117", "Category", "varchar(40)"),
            ("script", "10117", "Value", "int"), ("dbo", "plant_description", "plant_description", "nvarchar(100)"),
        ]);
        var view = new ModelSource(1, "Prod", "script", "10117", "none", null, Script: script);

        var sql = QueryCompiler.Compile(new DatasetModel([view, Plant], [], []),
            new QueryRequest(1, ["Prod.Category"], [], [new QueryFilter("Plant.plant_description", "in", ["Nimr"])]), Admin, catalog).Sql;

        Regex.Matches(sql, "DECLARE ").Count.Should().Be(5);
        sql.Should().MatchRegex(@"DECLARE @s0_plant AS NVARCHAR \(100\) = @p0;").And.Contain("dbo.fn_GetPeriods");
        sql.Should().MatchRegex(@"INSERT INTO #s0 \(\[Period\], \[Category\], \[Value\]\)\s+SELECT[\s\S]*ORDER BY m.seq, v.sort_order;");
    }
}
