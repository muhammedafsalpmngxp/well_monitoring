using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class ReportSheetsTests
{
    [Fact]
    public void A_one_page_report_is_one_sheet_of_its_shown_columns_under_their_headers()
    {
        var sheet = ReportSheets.Read("Wells", "vw_wells", "View", """
            {"columns":[{"field":"name","header":"Well"},{"field":"depth","header":"","shown":true},{"field":"cost","header":"Cost","shown":false},{"field":"Name","header":"Dup"}]}
            """).Single();

        sheet.Should().BeEquivalentTo(new ReportSheet("Wells", "vw_wells", "View", [new("name", "Well"), new("depth", "depth")]));
    }

    [Fact]
    public void A_multi_page_report_is_a_sheet_per_page()
        => ReportSheets.Read("Wells", "t0", "Table", """
            {"sheets":[{"name":"North","sourceName":"t1","sourceType":"Table","config":{"columns":[]}},
                       {"name":"South","sourceName":"v2","sourceType":"View","config":{}}]}
            """).Select(s => (s.Name, s.SourceName, s.SourceType)).Should().Equal(("North", "t1", "Table"), ("South", "v2", "View"));

    [Fact]
    public void Missing_or_broken_config_shows_every_column()
    {
        var sheet = ReportSheets.Read("Wells", "t0", "Table", "not json").Single();
        sheet.Columns.Should().BeEmpty();

        var table = ReportSheets.Table(sheet, ["a", "b", "A"], [new Dictionary<string, object?> { ["a"] = 1, ["b"] = 2 }]);
        table.Columns.Should().Equal("a", "b");
        table.Headers.Should().Equal("a", "b");
    }

    [Fact]
    public void Rows_keep_only_the_shown_columns()
    {
        var sheet = new ReportSheet("Wells", "t", "Table", [new("depth", "Depth")]);
        var table = ReportSheets.Table(sheet, ["name", "depth"], [new Dictionary<string, object?> { ["name"] = "W1", ["depth"] = 10 }]);

        table.Name.Should().Be("Wells");
        table.Headers.Should().Equal("Depth");
        table.Rows.Single().Should().BeEquivalentTo(new Dictionary<string, object?> { ["depth"] = 10 });
    }
}
