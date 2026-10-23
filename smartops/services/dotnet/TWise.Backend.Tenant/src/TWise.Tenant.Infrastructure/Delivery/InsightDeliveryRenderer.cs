using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// An Ask AI answer's insight report, built again at every run as the schedule's owner (the answer's query runs again,
/// the findings are worked out in code, the AI adds recommendations) and written into the mail with a link to the chat.
/// </summary>
public sealed class InsightDeliveryRenderer(IAiAskService ask, IConfiguration config) : IDeliveryRenderer
{
    public string TargetType => DeliveryTerms.Insight;

    public async Task<RenderedDelivery> RenderAsync(Schedule schedule, CancellationToken ct)
    {
        Domain.DTOs.AiInsightReportDto? report;
        // The report refuses an answer it cannot build (Ask your data off for the owner's role, too few groups); the run says why.
        try { report = await ask.ReportAsync(schedule.TargetId, schedule.TenantId, schedule.OwnerUserId, ct); }
        catch (InvalidOperationException ex) { throw new DeliveryException(ex.Message); }
        if (report is null) throw new DeliveryException("The answer no longer exists, or it is not in the schedule owner's chats.");
        var link = DeliveryLinks.For(config["App:PublicBaseUrl"], DeliveryTerms.Insight, schedule.TargetId);
        return new RenderedDelivery(report.Question, link, report.TotalRows == 0, [], Text: InsightReportText.Format(report));
    }
}
