using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Feedback;

public sealed class UnlikeAiMessageHandler(IAiAskService ask) : IRequestHandler<UnlikeAiMessageCommand, bool>
{
    public Task<bool> Handle(UnlikeAiMessageCommand c, CancellationToken ct) => ask.UnlikeAsync(c.MessageId, c.TenantId, c.UserId, ct);
}
