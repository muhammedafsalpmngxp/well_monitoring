using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed record ListAiAlertsQuery(long TenantId, long UserId) : IRequest<IReadOnlyList<AiAlertDto>>;
