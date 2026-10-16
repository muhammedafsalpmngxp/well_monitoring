using TWise.Tenant.Application.Features.Model.Imports;

namespace TWise.Tenant.UnitTests.Features.Model.Imports;

public sealed class ImportRulesTests
{
    // ZIP (xlsx) and OLE2 (xls) signatures, and plain text.
    private const string Zip = "504B0304140006000800";
    private const string Ole = "D0CF11E0A1B11AE10000";
    private const string Text = "437265772C486F7572730D0A";

    [Theory]
    [InlineData("crew.xlsx", Zip, "xlsx")]
    [InlineData("CREW.XLSX", Zip, "xlsx")]
    [InlineData("crew.xls", Ole, "xls")]
    [InlineData("crew.csv", Text, "csv")]
    [InlineData("crew.xlsx", Text, null)]
    [InlineData("crew.xls", Zip, null)]
    [InlineData("crew.csv", Zip, null)]
    [InlineData("crew.xlsm", Zip, null)]
    public void A_file_is_accepted_only_when_its_content_matches_its_extension(string fileName, string head, string? expected)
        => ImportRules.FileKind(fileName, Convert.FromHexString(head)).Should().Be(expected);

    [Theory]
    [InlineData("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab/edit#gid=0",
        "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab/export?format=xlsx")]
    [InlineData(" https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz ",
        "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=xlsx")]
    [InlineData("http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit", null)]
    [InlineData("https://docs.google.com.evil.test/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit", null)]
    [InlineData("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz@evil.test/edit", null)]
    [InlineData("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Only_a_Google_Sheets_link_gives_an_export_address(string? link, string? expected)
        => (ImportRules.GoogleSheetExport(link)?.AbsoluteUri).Should().Be(expected);

    [Theory]
    [InlineData("Crew_hours_2026", true)]
    [InlineData("C", true)]
    [InlineData("_crew", false)]
    [InlineData("2026_crew", false)]
    [InlineData("crew hours", false)]
    [InlineData("crew]hours", false)]
    public void A_table_name_starts_with_a_letter_and_uses_letters_digits_and_underscores(string name, bool valid)
        => ImportRules.IsTableName(name).Should().Be(valid);

    [Fact]
    public void A_table_name_is_at_most_100_characters()
    {
        ImportRules.IsTableName(new string('a', 100)).Should().BeTrue();
        ImportRules.IsTableName(new string('a', 101)).Should().BeFalse();
    }

    [Theory]
    [InlineData("Crew hours 2026.xlsx", "Sheet1", "Crew_hours_2026_Sheet1")]
    [InlineData("2026 plan.csv", null, "Upload_2026_plan")]
    [InlineData("--.xlsx", null, "Upload")]
    public void The_suggested_table_name_comes_from_the_file_and_the_sheet(string fileName, string? sheet, string expected)
        => ImportRules.SuggestTableName(fileName, sheet).Should().Be(expected);

    [Fact]
    public void Column_names_come_from_the_header_cells_and_are_unique()
        => ImportRules.ColumnNames(["Crew", "Amount (OMR)", null, "  ", "crew", "Well-ID", "Durée (h)", 2026.0])
            .Should().Equal("Crew", "Amount OMR", "Column 3", "Column 4", "crew 2", "Well ID", "Durée h", "2026");

    [Fact]
    public void Cells_read_as_the_preview_shows_them()
    {
        ImportRules.Cell(null).Should().Be("");
        ImportRules.Cell(DBNull.Value).Should().Be("");
        ImportRules.Cell("  A1 ").Should().Be("A1");
        ImportRules.Cell(7.5).Should().Be("7.5");
        ImportRules.Cell(new DateTime(2026, 9, 21)).Should().Be("2026-09-21");
        ImportRules.Cell(new DateTime(2026, 9, 21, 8, 30, 0)).Should().Be("2026-09-21 08:30:00");
        ImportRules.Cell(true).Should().Be("true");
        ImportRules.Cell(12.5m).Should().Be("12.5");
    }
}
