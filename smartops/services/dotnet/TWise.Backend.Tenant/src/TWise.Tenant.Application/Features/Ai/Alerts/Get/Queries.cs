using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed record ListAiAlertsQuery(long TenantId, long UserId) : IRequest<IReadOnlyList<AiAlertDto>>;

/// <summary>What the alert form may offer (from AiAlerts settings).</summary>
public sealed record GetAiAlertOptionsQuery : IRequest<AiAlertOptionsDto>;
