using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Conversations;

public sealed record ListAiConversationsQuery(long TenantId, long UserId) : IRequest<IReadOnlyList<AiConversationDto>>;
/// <summary>Null when the conversation is not the user's.</summary>
public sealed record GetAiConversationQuery(long TenantId, long UserId, long Id) : IRequest<AiConversationDetailDto?>;
/// <summary>The conversation holding the message (a scheduled insight mail links to its answer); null when it is not the user's.</summary>
public sealed record GetAiConversationByMessageQuery(long TenantId, long UserId, long MessageId) : IRequest<AiConversationDetailDto?>;
