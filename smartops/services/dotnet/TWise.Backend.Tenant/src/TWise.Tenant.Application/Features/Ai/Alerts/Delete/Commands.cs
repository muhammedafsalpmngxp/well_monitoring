using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed record DeleteAiAlertCommand(long TenantId, long UserId, long Id) : IRequest<bool>;
