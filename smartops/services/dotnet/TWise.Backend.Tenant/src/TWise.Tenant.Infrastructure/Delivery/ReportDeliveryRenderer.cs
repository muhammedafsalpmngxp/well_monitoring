using System.Text.Json;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Features.Common;
using TWise.Tenant.Application.Features.DatabaseViews;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// A report as Excel (a sheet per page) or CSV (a file per page). The rows come the way the report viewer reads them: a
/// View Builder view from its stored preview, else by running it; any other source through GET api/common/table-data.
/// </summary>
public sealed class ReportDeliveryRenderer(TenantDbContext db, ISender sender, IConfiguration config) : IDeliveryRenderer
{
    public string TargetType => DeliveryTerms.Report;

    public async Task<RenderedDelivery> RenderAsync(Schedule schedule, CancellationToken ct)
    {
        var report = await db.Reports.AsNoTracking().Where(TargetAccess.Reports(schedule.TenantId, schedule.OwnerUserId))
            .FirstOrDefaultAsync(r => r.Id == schedule.TargetId, ct)
            ?? throw new DeliveryException("The report no longer exists, or the schedule's owner can no longer read it.");
        var link = DeliveryLinks.For(config["App:PublicBaseUrl"], DeliveryTerms.Report, report.Id);
        if (schedule.Format == DeliveryTerms.Link) return new RenderedDelivery(report.ReportName, link, false, []);

        var tables = new List<DeliveryTable>();
        foreach (var sheet in ReportSheets.Read(report.ReportName, report.SourceName, report.SourceType, report.ReportJson))
        {
            var (columns, rows) = await RowsAsync(sheet, schedule.TenantId, ct);
            tables.Add(ReportSheets.Table(sheet, columns, rows));
        }

        var isEmpty = tables.All(t => t.Rows.Count == 0);
        var name = FileName(report.ReportName);
        IReadOnlyList<MailAttachment> files = schedule.Format == DeliveryTerms.Csv
            ? tables.Select(t => new MailAttachment(
                tables.Count == 1 ? $"{name}.csv" : $"{name} - {FileName(t.Name)}.csv", "text/csv", DeliveryCsv.Write(t))).ToList()
            : [new MailAttachment($"{name}.xlsx", DeliveryWorkbook.ContentType, DeliveryWorkbook.Write(tables))];
        return new RenderedDelivery(report.ReportName, link, isEmpty, files);
    }

    private async Task<(IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyDictionary<string, object?>> Rows)> RowsAsync(
        ReportSheet sheet, long tenantId, CancellationToken ct)
    {
        if (sheet.SourceType != "View")
        {
            var data = await sender.Send(new GetTableDataQuery(sheet.SourceName, sheet.SourceType), ct)
                ?? throw new DeliveryException($"The report's source \"{sheet.SourceName}\" was not found.");
            return (data.Columns, data.Rows);
        }

        // As the viewer's loadViewData: the view by name, its stored preview when it has one, else the view run in full.
        var listed = (await sender.Send(new ListDatabaseViewsQuery(tenantId), ct)).FirstOrDefault(v => v.ViewName == sheet.SourceName);
        if (listed is null) return ([], []);
        var view = await sender.Send(new GetDatabaseViewQuery(listed.Id, tenantId), ct);
        if (Stored(view) is { } stored) return stored;
        var live = await sender.Send(new PreviewDatabaseViewCommand(new PreviewDatabaseViewRequest(listed.ConnectionId, ViewId: listed.Id, MaxRows: 0), tenantId), ct)
            ?? throw new DeliveryException($"The database connection of view \"{sheet.SourceName}\" was not found.");
        return (live.Columns, live.Rows);
    }

    private static (IReadOnlyList<string>, IReadOnlyList<IReadOnlyDictionary<string, object?>>)? Stored(DatabaseViewDto? view)
    {
        if (string.IsNullOrWhiteSpace(view?.PreviewColumnsJson)) return null;
        try
        {
            var columns = JsonSerializer.Deserialize<List<string>>(view.PreviewColumnsJson) ?? [];
            if (columns.Count == 0) return null;
            var rows = string.IsNullOrWhiteSpace(view.PreviewDataJson) ? [] : JsonSerializer.Deserialize<List<Dictionary<string, JsonElement>>>(view.PreviewDataJson) ?? [];
            return (columns, rows.Select(row => (IReadOnlyDictionary<string, object?>)row.ToDictionary(p => p.Key, p => DeliveryWorkbook.Plain(p.Value))).ToList());
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A name fit for an attachment: no control characters and none a file name may not hold, on any server.</summary>
    internal static string FileName(string name)
    {
        var clean = new string(name.Where(ch => !char.IsControl(ch) && !Path.GetInvalidFileNameChars().Contains(ch) && ch != '"').ToArray()).Trim();
        return clean.Length == 0 ? "Report" : clean.Length > 100 ? clean[..100] : clean;
    }
}
