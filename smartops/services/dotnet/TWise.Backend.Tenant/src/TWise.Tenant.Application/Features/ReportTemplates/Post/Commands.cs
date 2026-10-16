using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ReportTemplates;

/// <summary>
/// UserId and TenantId are extracted from the JWT by the controller and injected here.
/// </summary>
public record SaveReportTemplateCommand(SaveReportTemplateRequest Request, long UserId, long TenantId) : IRequest<ReportTemplateDto>;
