using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Conversations;

public sealed record ListAiConversationsQuery(long TenantId, long UserId) : IRequest<IReadOnlyList<AiConversationDto>>;
/// <summary>Null when the conversation is not the user's.</summary>
public sealed record GetAiConversationQuery(long TenantId, long UserId, long Id) : IRequest<AiConversationDetailDto?>;
