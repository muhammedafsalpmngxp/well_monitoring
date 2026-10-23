using MediatR;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Conversations;

public sealed class ListAiConversationsHandler(IAiConversationRepository conversations) : IRequestHandler<ListAiConversationsQuery, IReadOnlyList<AiConversationDto>>
{
    public async Task<IReadOnlyList<AiConversationDto>> Handle(ListAiConversationsQuery q, CancellationToken ct) =>
        (await conversations.ListAsync(q.TenantId, q.UserId.ToString(), ct)).Select(AiConversationMapping.ToDto).ToList();
}

public sealed class GetAiConversationHandler(IAiConversationRepository conversations) : IRequestHandler<GetAiConversationQuery, AiConversationDetailDto?>
{
    public Task<AiConversationDetailDto?> Handle(GetAiConversationQuery q, CancellationToken ct) =>
        AiConversationMapping.DetailAsync(conversations, q.TenantId, q.UserId, q.Id, ct);
}

public sealed class GetAiConversationByMessageHandler(IAiConversationRepository conversations)
    : IRequestHandler<GetAiConversationByMessageQuery, AiConversationDetailDto?>
{
    public async Task<AiConversationDetailDto?> Handle(GetAiConversationByMessageQuery q, CancellationToken ct) =>
        await conversations.GetMessageAsync(q.MessageId, ct) is { } msg
            ? await AiConversationMapping.DetailAsync(conversations, q.TenantId, q.UserId, msg.ConversationId, ct)
            : null;
}

internal static class AiConversationMapping
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static AiConversationDto ToDto(AiConversation c) => new(c.Id, c.SourceType, c.SourceId, c.SourceName, c.Title, AiDates.Utc(c.ModifiedAt));

    /// <summary>The user's conversation with its messages; null when it is not theirs.</summary>
    public static async Task<AiConversationDetailDto?> DetailAsync(IAiConversationRepository conversations, long tenantId, long userId, long id, CancellationToken ct)
    {
        var conv = await conversations.GetAsync(id, tenantId, userId.ToString(), ct);
        if (conv is null) return null;
        var messages = (await conversations.GetMessagesAsync(id, ct)).Select(m => new AiChatMessageDto(m.Id, m.Role, m.Content,
            m.QuerySpecJson is null ? null : JsonSerializer.Deserialize<AiQuerySpec>(m.QuerySpecJson, Json), AiDates.Utc(m.CreatedAt),
            AiAnswerSnapshots.FromJson(m.AnswerJson))).ToList();
        return new AiConversationDetailDto(ToDto(conv), messages);
    }
}
