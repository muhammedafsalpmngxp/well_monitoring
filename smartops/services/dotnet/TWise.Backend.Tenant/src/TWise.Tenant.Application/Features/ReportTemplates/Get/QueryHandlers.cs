using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ReportTemplates;

public sealed class GetReportTemplateHandler(IReportTemplateRepository repo)
    : IRequestHandler<GetReportTemplateQuery, List<ReportTemplateDto>>
{
    public async Task<List<ReportTemplateDto>> Handle(GetReportTemplateQuery query, CancellationToken ct)
    {
        var templates = await repo.GetBySourceAsync(query.SourceName, query.SourceType, query.Type, query.CustomName, query.UserId, ct);
        return templates
            .Select(template => new ReportTemplateDto(template.Id, template.CustomName, template.SourceName, template.SourceType, template.TemplateJson, template.Type ?? "Report", template.IsActive ?? true, template.CreatedAt, template.UpdatedAt, template.ViewId))
            .ToList();
    }
}
