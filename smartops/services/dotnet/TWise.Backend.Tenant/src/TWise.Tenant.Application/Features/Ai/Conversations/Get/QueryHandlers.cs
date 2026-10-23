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
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<AiConversationDetailDto?> Handle(GetAiConversationQuery q, CancellationToken ct)
    {
        var conv = await conversations.GetAsync(q.Id, q.TenantId, q.UserId.ToString(), ct);
        if (conv is null) return null;
        var messages = (await conversations.GetMessagesAsync(q.Id, ct)).Select(m => new AiChatMessageDto(m.Id, m.Role, m.Content,
            m.QuerySpecJson is null ? null : JsonSerializer.Deserialize<AiQuerySpec>(m.QuerySpecJson, Json), AiDates.Utc(m.CreatedAt),
            AiAnswerSnapshots.FromJson(m.AnswerJson))).ToList();
        return new AiConversationDetailDto(AiConversationMapping.ToDto(conv), messages);
    }
}

internal static class AiConversationMapping
{
    public static AiConversationDto ToDto(AiConversation c) => new(c.Id, c.SourceType, c.SourceId, c.SourceName, c.Title, AiDates.Utc(c.ModifiedAt));
}
