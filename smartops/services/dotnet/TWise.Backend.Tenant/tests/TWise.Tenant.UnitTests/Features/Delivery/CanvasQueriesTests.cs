using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Application.Features.Model.Query;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

/// <summary>The same requests canvas-config.util.ts itemQuery and sheetFilters build, without slicers and clicks.</summary>
public class CanvasQueriesTests
{
    private static readonly DateOnly Today = new(2026, 3, 31);

    private static CanvasLayout Layout(string items, string sheetFilters = "[]", string canvasFilters = "[]", string datasetId = "4")
        => CanvasQueries.Read($$$"""
            {"kind":"canvas","layout":{"version":2,"columns":20,"datasetId":{{{datasetId}}},"filters":{{{canvasFilters}}},
             "sheets":[{"name":"Sheet 1","filters":{{{sheetFilters}}},"items":{{{items}}}}]}}
            """)!;

    private static IReadOnlyList<(string Title, QueryRequest Query)> Exports(CanvasLayout layout) => CanvasQueries.Exports(layout, Today);

    [Fact]
    public void Json_that_is_not_a_canvas_reads_as_null()
    {
        CanvasQueries.Read("""{"widgets":[]}""").Should().BeNull();
        CanvasQueries.Read("not json").Should().BeNull();
    }

    [Fact]
    public void A_table_reads_its_rows_with_totals()
    {
        var (title, query) = Exports(Layout("""
            [{"id":"a","type":"table","title":"Wells","datasetId":4,"dimensions":["w.name"],"measures":["Depth"]}]
            """)).Single();

        title.Should().Be("Wells");
        query.DatasetId.Should().Be(4);
        query.Dimensions.Should().Equal("w.name");
        query.Measures.Should().Equal("Depth");
        query.TopN.Should().Be(200);
        query.Totals.Should().BeTrue();
        query.Draft.Should().BeFalse();
        query.Filters.Should().BeNull();
    }

    [Fact]
    public void A_table_without_totals_or_measures_has_none()
    {
        var query = Exports(Layout("""
            [{"id":"a","type":"table","title":"T","datasetId":4,"dimensions":["w.name"],"measures":["Depth"],"totals":false},
             {"id":"b","type":"table","title":"U","datasetId":4,"dimensions":["w.name"],"measures":[]}]
            """));
        query.Select(q => q.Query.Totals).Should().Equal(false, false);
    }

    [Fact]
    public void A_matrix_reads_up_to_500_rows_with_totals()
    {
        var query = Exports(Layout("""
            [{"id":"a","type":"matrix","title":"M","datasetId":4,"dimensions":["w.region","w.name"],"measures":["Depth"]}]
            """)).Single().Query;
        query.TopN.Should().Be(500);
        query.Totals.Should().BeTrue();
    }

    [Fact]
    public void A_tile_reads_its_target_and_comparison_in_one_query()
        => Exports(Layout("""
            [{"id":"a","type":"tile","title":"Depth","datasetId":4,"dimensions":[],"measures":["Depth"],"target":"Plan","compare":"Depth","gauge":false}]
            """)).Single().Query.Measures.Should().Equal("Depth", "Plan");

    [Fact]
    public void A_column_chart_reads_its_top_level_biggest_first()
    {
        var query = Exports(Layout("""
            [{"id":"a","type":"chart","chartType":"column","title":"C","datasetId":4,"dimensions":["w.region","w.name"],"measures":["Depth"],"tooltips":["Wells"]}]
            """)).Single().Query;
        query.Dimensions.Should().Equal("w.region");
        query.Measures.Should().Equal("Depth", "Wells");
        query.TopN.Should().Be(50);
        query.Sort.Should().Be(new QuerySort("Depth", true));
    }

    [Fact]
    public void A_line_chart_sorts_by_its_sort_by_field_which_is_grouped_too()
    {
        var query = Exports(Layout("""
            [{"id":"a","type":"chart","chartType":"line","title":"L","datasetId":4,"dimensions":["d.month_name"],"measures":["Depth"],"sortBy":"d.month_no"}]
            """)).Single().Query;
        query.Dimensions.Should().Equal("d.month_name", "d.month_no");
        query.Sort.Should().Be(new QuerySort("d.month_no", false));
    }

    [Fact]
    public void A_chart_split_into_series_keeps_its_biggest_series_and_categories()
    {
        var query = Exports(Layout("""
            [{"id":"a","type":"chart","chartType":"bar","title":"S","datasetId":4,"dimensions":["w.region"],"measures":["Depth"],"series":"w.rig"}]
            """)).Single().Query;
        query.Dimensions.Should().Equal("w.region", "w.rig");
        query.TopN.Should().Be(400);
        query.Sort.Should().Be(new QuerySort("w.region", false));
        query.Filters.Should().BeEquivalentTo(new[]
        {
            new QueryFilter("w.rig", "top", ["8", "Depth"]),
            new QueryFilter("w.region", "top", ["50", "Depth"]),
        });
    }

    [Fact]
    public void A_scatter_chart_reads_x_then_y_and_500_points()
    {
        var query = Exports(Layout("""
            [{"id":"a","type":"chart","chartType":"scatter","title":"P","datasetId":4,"dimensions":["w.name"],"measures":["Depth"],"xMeasure":"Cost"}]
            """)).Single().Query;
        query.Measures.Should().Equal("Cost", "Depth");
        query.TopN.Should().Be(500);
    }

    [Fact]
    public void Values_added_up_on_the_object_travel_with_the_query()
        => Exports(Layout("""
            [{"id":"a","type":"table","title":"T","datasetId":4,"dimensions":["w.name"],"measures":["Sum of depth"],
              "aggregates":{"Sum of depth":{"field":"w.depth","fn":"sum","kind":"number"}}}]
            """)).Single().Query.Values.Should().Equal(new FieldValue("Sum of depth", "w.depth", "sum"));

    [Fact]
    public void Canvas_sheet_and_object_filters_apply_in_that_order()
    {
        var query = Exports(Layout(
            """
            [{"id":"a","type":"table","title":"T","datasetId":4,"dimensions":["w.name"],"measures":[],
              "filters":[{"field":"w.depth","kind":"number","mode":"advanced","values":[],"op":"between","value":"1","value2":"9"}]}]
            """,
            sheetFilters: """[{"field":"w.region","kind":"text","mode":"basic","values":["North"],"exclude":true}]""",
            canvasFilters: """[{"field":"w.spud","kind":"date","mode":"advanced","values":[],"op":"last_months","value":"1"}]""")).Single().Query;

        query.Filters.Should().BeEquivalentTo(new[]
        {
            new QueryFilter("w.spud", "gte", ["2026-02-28"]),
            new QueryFilter("w.region", "not_in", ["North"]),
            new QueryFilter("w.depth", "between", ["1", "9"]),
        }, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Two_conditions_joined_with_or_become_one_any_filter_and_top_n_passes_through()
    {
        var query = Exports(Layout(
            """[{"id":"a","type":"table","title":"T","datasetId":4,"dimensions":["w.name"],"measures":[]}]""",
            sheetFilters: """
                [{"field":"w.name","kind":"text","mode":"advanced","values":[],"op":"starts_with","value":"A","second":{"join":"or","op":"blank"}},
                 {"field":"w.name","kind":"text","mode":"top","values":[],"top":{"direction":"bottom","count":5,"measure":"w.depth","fn":"avg"}},
                 {"field":"w.name","kind":"text","mode":"basic","values":[]}]
                """)).Single().Query;

        query.Filters.Should().BeEquivalentTo(new[]
        {
            new QueryFilter("w.name", "any", null, [new QueryFilter("w.name", "starts_with", ["A"]), new QueryFilter("w.name", "is_null")]),
            new QueryFilter("w.name", "bottom", ["5", "w.depth", "avg"]),
        }, o => o.WithStrictOrdering());
    }

    [Fact]
    public void Slicers_text_images_and_incomplete_objects_are_not_exported()
        => Exports(Layout("""
            [{"id":"s","type":"slicer","title":"S","datasetId":4,"dimensions":["w.region"],"measures":[],"slicer":{"kind":"list","values":["North"]}},
             {"id":"t","type":"text","title":"Text","datasetId":null,"dimensions":[],"measures":[],"text":"Hi"},
             {"id":"c","type":"chart","title":"Empty","datasetId":4,"dimensions":[],"measures":[]},
             {"id":"m","type":"matrix","title":"No values","datasetId":4,"dimensions":["w.name"],"measures":[]},
             {"id":"x","type":"table","title":"Ok","datasetId":4,"dimensions":["w.name"],"measures":[]}]
            """)).Select(e => e.Title).Should().Equal("Ok");

    [Fact]
    public void An_object_on_another_dataset_gets_no_canvas_filters()
        => Exports(Layout(
            """[{"id":"a","type":"table","title":"Old","datasetId":9,"dimensions":["x.name"],"measures":[]}]""",
            canvasFilters: """[{"field":"w.region","kind":"text","mode":"basic","values":["North"]}]"""))
            .Single().Query.Filters.Should().BeNull();

    [Fact]
    public void A_canvas_without_a_dataset_uses_its_first_data_object()
        => Exports(Layout(
            """[{"id":"a","type":"table","title":"T","datasetId":4,"dimensions":["w.name"],"measures":[]}]""",
            canvasFilters: """[{"field":"w.region","kind":"text","mode":"basic","values":["North"]}]""", datasetId: "null"))
            .Single().Query.Filters.Should().ContainSingle();

    [Fact]
    public void A_broken_object_is_dropped_and_the_rest_are_kept()
        => Exports(Layout("""
            [{"id":"a","type":"table","title":"Broken","datasetId":"four","dimensions":["w.name"],"measures":[]},
             {"id":"b","type":"table","title":"","datasetId":4,"dimensions":["w.name"],"measures":[]}]
            """)).Select(e => e.Title).Should().Equal("New table");

    [Fact]
    public void Headers_use_the_canvas_names_else_the_column_without_its_table()
    {
        var layout = CanvasQueries.Read("""
            {"kind":"canvas","layout":{"version":2,"sheets":[],"fields":{"names":{"w.name":"Well"},"hidden":[]}}}
            """)!;
        CanvasQueries.Header(layout, "w.name").Should().Be("Well");
        CanvasQueries.Header(layout, "w.depth").Should().Be("depth");
        CanvasQueries.Header(layout, "Total depth").Should().Be("Total depth");
    }
}
