using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ReportTemplates;

public sealed class SaveReportTemplateHandler(IReportTemplateRepository repo)
    : IRequestHandler<SaveReportTemplateCommand, ReportTemplateDto>
{
    public async Task<ReportTemplateDto> Handle(SaveReportTemplateCommand cmd, CancellationToken ct)
    {
        var saved = await repo.UpsertAsync(
            cmd.Request.CustomName, cmd.Request.SourceName, cmd.Request.SourceType, cmd.Request.TemplateJson, cmd.Request.Type, cmd.Request.ViewId, cmd.UserId, cmd.TenantId, ct);
        return new ReportTemplateDto(saved.Id, saved.CustomName, saved.SourceName, saved.SourceType, saved.TemplateJson, saved.Type ?? "Report", saved.IsActive ?? true, saved.CreatedAt, saved.UpdatedAt, saved.ViewId);
    }
}
