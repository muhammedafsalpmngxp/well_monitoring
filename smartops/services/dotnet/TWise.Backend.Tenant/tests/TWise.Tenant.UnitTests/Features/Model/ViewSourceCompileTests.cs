using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using static TWise.Tenant.UnitTests.Features.Model.QueryCompilerTests;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ViewSourceCompileTests
{
    private static bool AnyTable(string schema, string table) => true;

    private static CheckedViewSql View(string sql) => ViewSource.Prepare(sql, "One row per well.", AnyTable).Sql!;

    private static readonly SchemaCatalog WithView = new([
        ("core", "WellDaily", "WellId"), ("core", "WellDaily", "OilBbl"),
        ("view", "5", "WellId"), ("view", "5", "WellName"), ("view", "5", "PlantCode"),
    ]);

    [Fact]
    public void A_view_source_is_a_derived_table_of_its_checked_sql()
    {
        var view = View("SELECT w.WellId, w.WellName, w.PlantCode FROM core.Well AS w");
        var wells = new ModelSource(1, "w", "view", "5", "none", null, view);
        var count = new ModelMeasure("Wells", new AggregateNode("count", new ColumnNode("w", "WellId")));

        var result = QueryCompiler.Compile(new DatasetModel([wells], [], [count]), new QueryRequest(1, ["w.WellName"], ["Wells"]), Admin, WithView);

        result.Sql.Should().Be(
            $"SELECT TOP (@top) [w].[WellName] AS [w.WellName], COUNT([w].[WellId]) AS [Wells]\nFROM ({view.Sql}) AS [w]\nGROUP BY [w].[WellName]");
    }

    [Fact]
    public void A_joined_view_gets_the_plant_filter_on_its_own_column()
    {
        var view = View("SELECT w.WellId, w.WellName, w.PlantCode FROM core.Well AS w");
        var wells = new ModelSource(1, "w", "view", "5", "plant", "PlantCode", view);

        var result = QueryCompiler.Compile(new DatasetModel([wells, Daily], [DailyToWell], [TotalOil]),
            new QueryRequest(1, ["w.WellName"], ["Total Oil"]), PlantUser, WithView);

        result.Sql.Should().Be(
            "SELECT TOP (@top) [w].[WellName] AS [w.WellName], SUM([d].[OilBbl]) AS [Total Oil]\n" +
            "FROM [core].[WellDaily] AS [d]\n" +
            $"LEFT JOIN ({view.Sql}) AS [w] ON [d].[WellId] = [w].[WellId]\n" +
            "WHERE [w].[PlantCode] IN (@p0, @p1)\n" +
            "GROUP BY [w].[WellName]");
        result.Parameters.Should().Equal(new Dictionary<string, object> { ["@p0"] = 101, ["@p1"] = 102, ["@top"] = QueryCompiler.DefaultTopN });
    }

    [Fact]
    public void A_view_with_a_transform_is_read_through_its_cte_from_the_derived_table()
    {
        var view = View("SELECT w.WellId, w.WellName, w.PlantCode FROM core.Well AS w");
        var wells = new ModelSource(1, "w", "view", "5", "none", null, view);
        var count = new ModelMeasure("Wells", new AggregateNode("count", new ColumnNode("w", "WellId")));

        var result = QueryCompiler.Compile(new DatasetModel([wells], [], [count], [], [new ModelTransform(1, "WellName", "trim")]),
            new QueryRequest(1, ["w.WellName"], ["Wells"]), Admin, WithView);

        result.Sql.Should().Be(
            $"WITH [w] AS (SELECT LTRIM(RTRIM([WellName])) AS [WellName], [WellId] FROM ({view.Sql}) AS [w])\n" +
            "SELECT TOP (@top) [w].[WellName] AS [w.WellName], COUNT([w].[WellId]) AS [Wells]\nFROM [w]\nGROUP BY [w].[WellName]");
    }

    [Fact]
    public void A_table_sample_names_its_columns_as_the_catalogue_spells_them()
    {
        var result = QueryCompiler.Sample(new ModelSource(0, "t", "core", "Well", "none", null), ["wellname", "WellId"], Catalog, 50);

        result.Sql.Should().Be("SELECT TOP (@top) [WellName], [WellId]\nFROM [core].[Well] AS [t]");
        result.Parameters.Should().Equal(new Dictionary<string, object> { ["@top"] = 50 });
        result.Columns.Should().Equal("WellName", "WellId");
    }

    [Fact]
    public void A_view_sample_reads_the_derived_table_and_caps_the_rows()
    {
        var view = View("SELECT w.WellId, w.WellName, w.PlantCode FROM core.Well AS w");

        var result = QueryCompiler.Sample(new ModelSource(0, "t", "view", "5", "none", null, view), ["WellName"], WithView, 500);

        result.Sql.Should().Be($"SELECT TOP (@top) [WellName]\nFROM ({view.Sql}) AS [t]");
        result.Parameters["@top"].Should().Be(100);
    }

    [Fact]
    public void A_sample_refuses_a_column_the_source_does_not_have()
    {
        var act = () => QueryCompiler.Sample(new ModelSource(0, "t", "core", "Well", "none", null), ["Nope"], Catalog, 50);

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);
    }
}
