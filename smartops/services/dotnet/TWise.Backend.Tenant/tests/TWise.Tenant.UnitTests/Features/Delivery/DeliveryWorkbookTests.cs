using ClosedXML.Excel;
using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Infrastructure.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class DeliveryWorkbookTests
{
    private static DeliveryTable Table(string name, params IReadOnlyDictionary<string, object?>[] rows)
        => new(name, ["w.name", "Depth", "w.spud"], ["Well", "Depth", "Spud"], rows);

    [Fact]
    public void Each_table_is_a_sheet_with_a_bold_header_and_typed_values()
    {
        var bytes = DeliveryWorkbook.Write([Table("Wells", new Dictionary<string, object?> { ["w.name"] = "=W1", ["Depth"] = 1250.5m, ["w.spud"] = "2026-09-01" })]);

        using var book = new XLWorkbook(new MemoryStream(bytes));
        var sheet = book.Worksheet("Wells");
        sheet.Cell(1, 1).GetText().Should().Be("Well");
        sheet.Cell(1, 1).Style.Font.Bold.Should().BeTrue();
        sheet.Cell(2, 1).GetText().Should().Be("=W1");
        sheet.Cell(2, 1).HasFormula.Should().BeFalse();
        sheet.Cell(2, 2).GetDouble().Should().Be(1250.5);
        sheet.Cell(2, 3).GetDateTime().Should().Be(new DateTime(2026, 9, 1));
    }

    [Fact]
    public void Sheet_names_are_made_valid_and_unique()
    {
        var bytes = DeliveryWorkbook.Write([Table("Wells [North]: 2026/Q3 and a very long title"), Table("Wells [North]: 2026/Q3 and a very long title"), Table("  ")]);

        using var book = new XLWorkbook(new MemoryStream(bytes));
        book.Worksheets.Select(w => w.Name).Should().Equal("Wells North 2026Q3 and a very l", "Wells North 2026Q3 and a ve (2)", "Data");
    }

    [Fact]
    public void Attachment_names_lose_control_and_file_system_characters()
        => ReportDeliveryRenderer.FileName("Wells\r\n/North:\t\"Q3\"").Should().Be("WellsNorthQ3");
}
