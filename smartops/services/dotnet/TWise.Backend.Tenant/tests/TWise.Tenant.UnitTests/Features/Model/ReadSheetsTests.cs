using System.IO.Compression;
using System.Text;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ReadSheetsTests
{
    private static IReadOnlyList<ImportSheet> Read(string csv, string fileName, int maxRows, int maxCells = ImportRules.MaxCells)
        => new FileImportParserService().ReadSheets(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "csv", fileName, null, maxRows, maxCells);

    private static IReadOnlyList<ImportSheet> ReadWorkbook(byte[] xlsx, string? sheet, int maxCells = ImportRules.MaxCells)
        => new FileImportParserService().ReadSheets(new MemoryStream(xlsx), "xlsx", "book.xlsx", sheet, ImportRules.MaxSheetRows, maxCells);

    /// <summary>A minimal workbook: each sheet has the given number of rows of two number cells.</summary>
    private static byte[] Workbook(params (string Name, int Rows)[] sheets)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Entry(string path, string text)
            {
                using var writer = new StreamWriter(zip.CreateEntry(path).Open());
                writer.Write(text);
            }

            const string main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            const string rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            Entry("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>");
            Entry("_rels/.rels", $"<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + $"<Relationship Id=\"r1\" Type=\"{rel}/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Entry("xl/workbook.xml", $"<?xml version=\"1.0\"?><workbook xmlns=\"{main}\" xmlns:r=\"{rel}\"><sheets>"
                + string.Concat(sheets.Select((s, i) => $"<sheet name=\"{s.Name}\" sheetId=\"{i + 1}\" r:id=\"s{i + 1}\"/>"))
                + "</sheets></workbook>");
            Entry("xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + string.Concat(sheets.Select((_, i) => $"<Relationship Id=\"s{i + 1}\" Type=\"{rel}/worksheet\" Target=\"worksheets/sheet{i + 1}.xml\"/>"))
                + "</Relationships>");
            for (var i = 0; i < sheets.Length; i++)
                Entry($"xl/worksheets/sheet{i + 1}.xml", $"<?xml version=\"1.0\"?><worksheet xmlns=\"{main}\"><sheetData>"
                    + string.Concat(Enumerable.Range(1, sheets[i].Rows).Select(r => $"<row r=\"{r}\"><c r=\"A{r}\"><v>{r}</v></c><c r=\"B{r}\"><v>{r * 2}</v></c></row>"))
                    + "</sheetData></worksheet>");
        }
        return memory.ToArray();
    }

    [Fact]
    public void A_csv_file_is_one_sheet_of_text_cells_with_its_blank_lines_kept_in_place()
    {
        var sheets = Read("Crew,Hours\r\nA1,8\r\n\r\n\"B, 2\",7.5\r\nTotal,15.5\r\n", "crew hours.csv", 100);

        sheets.Should().ContainSingle();
        sheets[0].Name.Should().Be("crew hours");
        sheets[0].Truncated.Should().BeFalse();
        sheets[0].Rows.Select(row => string.Join("|", row.Select(ImportRules.Cell)))
            .Should().Equal("Crew|Hours", "A1|8", "", "B, 2|7.5", "Total|15.5");
    }

    [Fact]
    public void Reading_stops_at_the_row_cap_and_says_so()
    {
        var sheet = Read("1\n2\n3\n4\n5\n", "n.csv", 3)[0];

        sheet.Rows.Should().HaveCount(3);
        sheet.Truncated.Should().BeTrue();
        Read("1\n2\n3\n", "n.csv", 3)[0].Truncated.Should().BeFalse();
    }

    [Fact]
    public void Reading_stops_at_the_cell_cap_and_says_so()
    {
        var sheet = Read("1,2\n3,4\n5,6\n7,8\n", "n.csv", 100, maxCells: 5)[0];

        sheet.Rows.Should().HaveCount(2);
        sheet.Truncated.Should().BeTrue();
    }

    [Fact]
    public void Only_the_named_sheet_of_a_workbook_is_read_and_every_sheet_is_listed()
    {
        var sheets = ReadWorkbook(Workbook(("Cover", 3), ("Hours", 4)), "Hours");

        sheets.Select(s => (s.Name, s.Rows.Count)).Should().Equal(("Cover", 0), ("Hours", 4));
    }

    [Fact]
    public void The_cell_cap_counts_every_sheet_and_reading_stops_at_the_first_truncation()
    {
        var sheets = ReadWorkbook(Workbook(("One", 3), ("Two", 3), ("Three", 3)), null, maxCells: 10);

        sheets.Select(s => (s.Name, s.Rows.Count, s.Truncated)).Should().Equal(("One", 3, false), ("Two", 2, true), ("Three", 0, false));
    }

    [Fact]
    public void A_workbook_that_unpacks_to_more_than_the_ceiling_is_refused_before_it_is_read()
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var entry = zip.CreateEntry("xl/worksheets/sheet1.xml", CompressionLevel.Fastest).Open();
            var zeros = new byte[1024 * 1024];
            for (var i = 0; i <= ImportRules.MaxUnpackedBytes / zeros.Length; i++) entry.Write(zeros);
        }

        var act = () => ReadWorkbook(memory.ToArray(), null);

        act.Should().Throw<ImportTooLargeException>();
    }

    [Fact]
    public void Parse_skips_a_title_block_above_the_header_and_leaves_out_blank_rows()
    {
        var csv = "Job Progress Report,,\r\n,Reporting period: August,\r\n,,\r\nWeek,Plan %,Actual %\r\nW1,0.5,0.4\r\n,,\r\nW2,0.6,\r\n";

        var result = new FileImportParserService().Parse(new MemoryStream(Encoding.UTF8.GetBytes(csv)), "report.csv", "csv");

        result.Columns.Select(c => c.Name).Should().Equal("Week", "Plan %", "Actual %");
        result.Rows.Select(r => r["Week"]).Should().Equal("W1", "W2");
        result.Rows[0]["Plan %"].Should().Be(0.5);
    }
}
