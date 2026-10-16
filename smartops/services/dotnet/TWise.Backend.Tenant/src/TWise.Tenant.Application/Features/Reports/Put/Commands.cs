using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reports;

public record UpdateReportCommand(long Id, UpdateReportRequest Request, long UserId, bool IsAdmin) : IRequest<ReportDto?>;
