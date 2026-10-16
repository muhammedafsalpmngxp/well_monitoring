using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// A canvas as Excel: a sheet per chart, tile, table and matrix, with the rows the object shows, read through the same
/// POST /api/query path as the canvas (published model, the owner's row scope). Slicer choices are not applied.
/// </summary>
public sealed class CanvasDeliveryRenderer(TenantDbContext db, ISender sender, IConfiguration config) : IDeliveryRenderer
{
    public string TargetType => DeliveryTerms.Canvas;

    public async Task<RenderedDelivery> RenderAsync(Schedule schedule, CancellationToken ct)
    {
        var canvas = await BoardAsync(db, schedule.TargetId, schedule.OwnerUserId, ct);
        if (canvas is null || DashboardKind.Of(canvas.ConfigJson) != DashboardKind.Canvas)
            throw new DeliveryException("The canvas no longer exists, or the schedule's owner can no longer read it.");
        var link = DeliveryLinks.For(config["App:PublicBaseUrl"], DeliveryTerms.Canvas, canvas.DashboardId);
        if (schedule.Format == DeliveryTerms.Link) return new RenderedDelivery(canvas.DashboardName, link, false, []);

        var layout = CanvasQueries.Read(canvas.ConfigJson) ?? throw new DeliveryException("The canvas could not be read.");
        var tables = new List<DeliveryTable>();
        var notes = new List<string>();
        foreach (var (title, query) in CanvasQueries.Exports(layout, Today(schedule.TimeZone)))
        {
            QueryResult result;
            try
            {
                result = await sender.Send(new RunModelQueryCommand(query, schedule.TenantId), ct);
            }
            catch (QueryException ex)
            {
                throw new DeliveryException($"\"{title}\" could not be read: {ex.Message}");
            }
            if (result.SkippedFilters.Count > 0)
                notes.Add($"\"{title}\" is not filtered by: {string.Join(", ", result.SkippedFilters.Select(f => CanvasQueries.Header(layout, f)))}.");
            var columns = result.Columns.Where(c => c != QueryCompiler.LevelColumn).ToList();
            tables.Add(new DeliveryTable(title, columns, columns.Select(c => CanvasQueries.Header(layout, c)).ToList(), result.Rows));
        }

        var file = new MailAttachment($"{ReportDeliveryRenderer.FileName(canvas.DashboardName)}.xlsx", DeliveryWorkbook.ContentType, DeliveryWorkbook.Write(tables));
        return new RenderedDelivery(canvas.DashboardName, link, tables.All(t => t.Rows.Count == 0), [file], notes.Count > 0 ? string.Join(" ", notes) : null);
    }

    /// <summary>
    /// A dashboard or canvas row the owner may read (TargetAccess); core.Dashboard ids are int and the tenant database
    /// holds one tenant's rows.
    /// </summary>
    internal static Task<Domain.Entities.Dashboard?> BoardAsync(TenantDbContext db, long id, long ownerUserId, CancellationToken ct)
        => id is > 0 and <= int.MaxValue
            ? db.Dashboards.AsNoTracking().Where(TargetAccess.Boards(ownerUserId)).FirstOrDefaultAsync(d => d.DashboardId == (int)id, ct)
            : Task.FromResult<Domain.Entities.Dashboard?>(null);

    /// <summary>Today in the schedule's time zone, for relative date filters such as "in the last 3 months".</summary>
    private static DateOnly Today(string timeZone)
        => DateOnly.FromDateTime(TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out var zone)
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone)
            : DateTime.UtcNow);
}
