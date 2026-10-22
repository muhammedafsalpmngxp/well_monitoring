using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataViews;

public sealed class SaveAskDataViewHandler(IAiAskService ask) : IRequestHandler<SaveAskDataViewCommand, AskDataViewDto?>
{
    public Task<AskDataViewDto?> Handle(SaveAskDataViewCommand c, CancellationToken ct) => ask.SaveAskDataViewAsync(c.MessageId, c.TenantId, c.UserId, ct);
}
