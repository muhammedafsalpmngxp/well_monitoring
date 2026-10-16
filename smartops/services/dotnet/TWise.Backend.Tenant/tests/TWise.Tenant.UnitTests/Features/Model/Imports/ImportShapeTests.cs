using TWise.Tenant.Application.Features.Model.Imports;

namespace TWise.Tenant.UnitTests.Features.Model.Imports;

public sealed class ImportShapeTests
{
    private static readonly DateTime Sep1 = new(2026, 9, 1);
    private static readonly DateTime Sep2 = new(2026, 9, 2);

    // Rows 1 to 10 of the sheet. Column D is blank everywhere, as Excel often reports one column too many.
    private static readonly ImportSheet Hours = new("Hours", [
        ["Crew hours, September", null, null, null],
        [null, null, null, null],
        ["Crew", "Date", "Hours", null],
        ["A1", Sep1, 8.0, null],
        [null, null, null, null],
        ["B2", Sep2, 7.5, null],
        ["C3", Sep2, 6.0, null],
        [null, null, null, null],
        ["Total", null, 21.5, null],
        [null, null, null, null],
    ]);

    [Fact]
    public void The_suggested_rows_skip_the_title_and_the_blank_and_total_rows_at_the_bottom()
        => ImportRules.SuggestRange(Hours.Rows).Should().Be((3, 7));

    [Fact]
    public void A_blank_sheet_suggests_no_rows()
        => ImportRules.SuggestRange([[null, ""], [null, null]]).Should().Be((0, 0));

    [Fact]
    public void The_shape_infers_types_skips_blank_rows_and_keeps_sheet_row_numbers()
    {
        var shape = ImportRules.Shape(Hours, 3, 7);

        shape.IsSuccess.Should().BeTrue(shape.ErrorMessage);
        shape.Value!.Columns.Should().Equal(new ImportColumn("Crew", "text"), new ImportColumn("Date", "date"), new ImportColumn("Hours", "decimal"));
        shape.Value.RowNumbers.Should().Equal(4, 6, 7);
        shape.Value.Rows[0].Should().Equal("A1", Sep1, 8m);
        shape.Value.Rows[1].Should().Equal("B2", Sep2, 7.5m);
    }

    [Fact]
    public void A_value_that_does_not_fit_the_chosen_type_names_its_row_and_column()
    {
        var shape = ImportRules.Shape(Hours, 3, 7, ["text", "whole", "decimal"]);

        shape.IsValidationError.Should().BeTrue();
        shape.ErrorMessage.Should().Be("Row 4, column Date: \"2026-09-01\" is not a whole number. Choose Text for this column, or correct the file.");
    }

    [Theory]
    [InlineData(0, 7, "The header row must be between 1 and 10.")]
    [InlineData(3, 3, "The last data row must be after the header row and at most 10.")]
    [InlineData(3, 11, "The last data row must be after the header row and at most 10.")]
    [InlineData(1, 2, "There are no data rows between the header row and the last data row.")]
    public void A_range_that_cannot_be_loaded_is_refused(int headerRow, int lastRow, string message)
        => ImportRules.Shape(Hours, headerRow, lastRow).ErrorMessage.Should().Be(message);

    [Fact]
    public void Types_must_be_given_for_every_column()
        => ImportRules.Shape(Hours, 3, 7, ["text", "date"]).ErrorMessage.Should().Be("Choose a type for every column.");

    [Fact]
    public void A_sheet_cut_off_at_the_row_cap_is_refused()
        => ImportRules.Shape(Hours with { Truncated = true }, 3, 7).ErrorMessage
            .Should().Be("The sheet Hours has more than 100,000 rows or 3,000,000 cells. Split it into smaller files.");

    [Fact]
    public void A_blank_header_is_named_by_its_position()
        => ImportRules.Shape(new ImportSheet("S", [[null, "Hours"], ["x", 1.0]]), 1, 2).Value!.Columns
            .Should().Equal(new ImportColumn("Column 1", "text"), new ImportColumn("Hours", "whole"));

    [Fact]
    public void The_type_is_the_narrowest_one_every_value_fits()
    {
        ImportRules.InferType([true, "false"]).Should().Be("boolean");
        ImportRules.InferType(["1", 2.0, null]).Should().Be("whole");
        ImportRules.InferType([1.0, 2.5]).Should().Be("decimal");
        ImportRules.InferType([Sep1, "2026-09-02"]).Should().Be("date");
        ImportRules.InferType([Sep1, new DateTime(2026, 9, 1, 10, 0, 0)]).Should().Be("datetime");
        ImportRules.InferType(["01/02/2026"]).Should().Be("text");
        ImportRules.InferType(["1", "x"]).Should().Be("text");
        ImportRules.InferType([null, ""]).Should().Be("text");
    }

    [Fact]
    public void Values_convert_to_what_the_column_stores()
    {
        ImportRules.TryConvert(3.0, "whole", out var whole).Should().BeTrue();
        whole.Should().Be(3L);
        ImportRules.TryConvert(3.5, "whole", out _).Should().BeFalse();
        ImportRules.TryConvert("12.5", "decimal", out var number).Should().BeTrue();
        number.Should().Be(12.5m);
        ImportRules.TryConvert(0.12345678, "decimal", out var rounded).Should().BeTrue();
        rounded.Should().Be(0.123457m);
        ImportRules.TryConvert("TRUE", "boolean", out var flag).Should().BeTrue();
        flag.Should().Be(true);
        ImportRules.TryConvert(new DateTime(2026, 9, 1, 10, 0, 0), "date", out var date).Should().BeTrue();
        date.Should().Be(Sep1);
        ImportRules.TryConvert("", "whole", out var blank).Should().BeTrue();
        blank.Should().BeNull();
    }
}
