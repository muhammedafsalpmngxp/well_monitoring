using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

/// <summary>Saves an alert on the user's answer and runs the first check; null when the message is not theirs.</summary>
public sealed record CreateAiAlertCommand(CreateAiAlertRequest Request, long TenantId, long UserId) : IRequest<AiAlertDto?>;
/// <summary>Runs the check now; notifies when the alert starts firing.</summary>
public sealed record CheckAiAlertCommand(long TenantId, long UserId, long Id) : IRequest<AiAlertDto?>;
