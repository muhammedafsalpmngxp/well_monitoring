using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ReportTemplates;

public record GetReportTemplateQuery(string? SourceName, string? SourceType, long UserId, string Type, string? CustomName) : IRequest<List<ReportTemplateDto>>;
