using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using SmartOps.Reports.Domain.Entities;
using SmartOps.Reports.Infrastructure;

namespace SmartOps.Reports.Services;

public interface IReportRenderer
{
    Task<byte[]> RenderPdfAsync(Report report);
    Task<byte[]> RenderXlsxAsync(Report report);
}

public sealed class ReportRenderer(ReportsDbContext db) : IReportRenderer
{
    public Task<byte[]> RenderPdfAsync(Report report)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        var doc = Document.Create(c =>
        {
            c.Page(p =>
            {
                p.Size(PageSizes.A4);
                p.Margin(2, Unit.Centimetre);
                p.Header().Text(report.Name).FontSize(18).SemiBold();
                p.Content().Column(col =>
                {
                    col.Spacing(8);
                    col.Item().Text($"Category: {report.Category}");
                    if (!string.IsNullOrEmpty(report.Description))
                        col.Item().Text(report.Description);
                    col.Item().Text($"Generated: {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC")
                       .FontSize(10).FontColor(Colors.Grey.Medium);
                });
                p.Footer().AlignCenter().Text(t =>
                    t.Span("SmartOps · Page ").FontSize(9));
            });
        });
        return Task.FromResult(doc.GeneratePdf());
    }

    public Task<byte[]> RenderXlsxAsync(Report report)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(report.Name[..Math.Min(31, report.Name.Length)]);
        ws.Cell(1, 1).Value = "Field";
        ws.Cell(1, 2).Value = "Value";
        ws.Cell(2, 1).Value = "Key"; ws.Cell(2, 2).Value = report.Key;
        ws.Cell(3, 1).Value = "Category"; ws.Cell(3, 2).Value = report.Category;
        ws.Cell(4, 1).Value = "Description"; ws.Cell(4, 2).Value = report.Description ?? "";
        ws.Cell(5, 1).Value = "Generated"; ws.Cell(5, 2).Value = DateTime.UtcNow;
        ws.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return Task.FromResult(ms.ToArray());
    }
}
