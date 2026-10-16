using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Conversations;

/// <summary>Soft-deletes the user's conversation; false when it is not theirs.</summary>
public sealed record DeleteAiConversationCommand(long TenantId, long UserId, long Id) : IRequest<bool>;
