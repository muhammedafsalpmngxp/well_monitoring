using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed class CreateAiAlertHandler(IAiAlertService alerts) : IRequestHandler<CreateAiAlertCommand, AiAlertDto?>
{
    public Task<AiAlertDto?> Handle(CreateAiAlertCommand c, CancellationToken ct) => alerts.CreateAsync(c.Request, c.TenantId, c.UserId, ct);
}

public sealed class CheckAiAlertHandler(IAiAlertService alerts) : IRequestHandler<CheckAiAlertCommand, AiAlertDto?>
{
    public Task<AiAlertDto?> Handle(CheckAiAlertCommand c, CancellationToken ct) => alerts.CheckAsync(c.Id, c.TenantId, c.UserId, ct);
}
