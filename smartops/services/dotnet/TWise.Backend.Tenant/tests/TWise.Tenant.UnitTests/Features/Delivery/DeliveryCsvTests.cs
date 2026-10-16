using System.Text;
using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class DeliveryCsvTests
{
    private static string Text(byte[] bytes) => Encoding.UTF8.GetString(bytes);

    [Fact]
    public void Starts_with_a_byte_order_mark_so_Excel_reads_Arabic()
    {
        var bytes = DeliveryCsv.Write(new DeliveryTable("T", ["Well"], ["اسم"], [new Dictionary<string, object?> { ["Well"] = "بئر" }]));
        bytes.Take(3).Should().Equal(0xEF, 0xBB, 0xBF);
        Text(bytes[3..]).Should().Be("اسم\r\nبئر\r\n");
    }

    [Fact]
    public void Quotes_fields_with_commas_quotes_and_line_breaks()
    {
        var bytes = DeliveryCsv.Write(new DeliveryTable("T", ["a", "b", "c"], ["A", "B", "C"],
            [new Dictionary<string, object?> { ["a"] = "x,y", ["b"] = "say \"hi\"", ["c"] = "line1\nline2" }]));
        Text(bytes[3..]).Should().Be("A,B,C\r\n\"x,y\",\"say \"\"hi\"\"\",\"line1\nline2\"\r\n");
    }

    [Fact]
    public void Writes_numbers_dates_and_blanks_the_same_on_every_server()
    {
        var bytes = DeliveryCsv.Write(new DeliveryTable("T", ["n", "d", "e", "f"], ["N", "D", "E", "F"],
            [new Dictionary<string, object?> { ["n"] = 1234.5m, ["d"] = new DateTime(2026, 9, 28, 7, 5, 0), ["e"] = null, ["f"] = -3 }]));
        Text(bytes[3..]).Should().Be("N,D,E,F\r\n1234.5,2026-09-28 07:05:00,,-3\r\n");
    }

    [Fact]
    public void Text_that_a_spreadsheet_would_run_as_a_formula_is_prefixed()
    {
        var bytes = DeliveryCsv.Write(new DeliveryTable("T", ["a"], ["A"], [new Dictionary<string, object?> { ["a"] = "=HYPERLINK(\"x\")" }]));
        Text(bytes[3..]).Should().Be("A\r\n\"'=HYPERLINK(\"\"x\"\")\"\r\n");
    }

    [Fact]
    public void Headers_that_look_like_formulas_are_prefixed_too()
        => Text(DeliveryCsv.Write(new DeliveryTable("T", ["a"], ["=SUM(A1)"], []))[3..]).Should().Be("'=SUM(A1)\r\n");
}
