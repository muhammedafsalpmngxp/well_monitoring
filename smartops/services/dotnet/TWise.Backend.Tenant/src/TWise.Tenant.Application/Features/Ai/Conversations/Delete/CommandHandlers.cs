using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Conversations;

public sealed class DeleteAiConversationHandler(IAiConversationRepository conversations) : IRequestHandler<DeleteAiConversationCommand, bool>
{
    public async Task<bool> Handle(DeleteAiConversationCommand c, CancellationToken ct)
    {
        var conv = await conversations.GetAsync(c.Id, c.TenantId, c.UserId.ToString(), ct);
        if (conv is null) return false;
        conv.IsDeleted = true;
        await conversations.SaveAsync(ct);
        return true;
    }
}
