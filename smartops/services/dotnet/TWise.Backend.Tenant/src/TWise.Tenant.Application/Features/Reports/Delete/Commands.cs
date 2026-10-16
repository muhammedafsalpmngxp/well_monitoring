using MediatR;

namespace TWise.Tenant.Application.Features.Reports;

public record DeleteReportCommand(long Id, long UserId) : IRequest<bool>;
