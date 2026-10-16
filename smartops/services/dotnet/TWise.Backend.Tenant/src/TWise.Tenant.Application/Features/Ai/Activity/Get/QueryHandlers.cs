using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Activity;

public sealed class GetAiActivityHandler(IAiConversationRepository conversations, IRecipientResolver directory)
    : IRequestHandler<GetAiActivityQuery, AiActivityPageDto>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<AiActivityPageDto> Handle(GetAiActivityQuery q, CancellationToken ct)
    {
        var since = DateTime.UtcNow.AddDays(-Math.Clamp(q.Days, 1, 90));
        var (total, rows) = await conversations.SearchAnswersAsync(q.TenantId, since, q.Search, Math.Max(0, q.Skip), Math.Clamp(q.Take, 1, 200), ct);
        var questions = await conversations.GetQuestionsAsync(rows.Select(r => r.Message.Id).ToList(), ct);
        var names = await ActivityNames.ResolveAsync(directory, q.TenantId, rows.Select(r => r.Conversation.UserId), ct);
        var items = rows.Select(r =>
        {
            int? totalMs = null;
            if (r.Trace is not null)
                try { totalMs = JsonSerializer.Deserialize<List<AiTraceStep>>(r.Trace.TraceJson, Json)?.Sum(s => s.Ms); } catch (JsonException) { }
            var answer = r.Message.Content;
            return new AiActivityItemDto(r.Message.Id, r.Conversation.Id, r.Conversation.UserId, names.GetValueOrDefault(r.Conversation.UserId),
                r.Conversation.SourceType, r.Conversation.SourceId, r.Conversation.SourceName,
                questions.GetValueOrDefault(r.Message.Id, r.Conversation.Title), answer.Length > 300 ? answer[..300] + "…" : answer,
                r.Message.QuerySpecJson is not null, r.Trace is not null, totalMs, AiDates.Utc(r.Message.CreatedAt));
        }).ToList();
        return new AiActivityPageDto(total, items);
    }
}

public sealed class GetAiActivityTraceHandler(IAiConversationRepository conversations)
    : IRequestHandler<GetAiActivityTraceQuery, IReadOnlyList<AiTraceStep>?>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<AiTraceStep>?> Handle(GetAiActivityTraceQuery q, CancellationToken ct)
    {
        // An admin may only read traces of their own tenant: the message's conversation must belong to it.
        var msg = await conversations.GetMessageAsync(q.MessageId, ct);
        if (msg is null || await conversations.GetForTenantAsync(msg.ConversationId, q.TenantId, ct) is null) return null;
        var trace = await conversations.GetTraceAsync(msg.Id, ct);
        if (trace is null) return null;
        return JsonSerializer.Deserialize<List<AiTraceStep>>(trace.TraceJson, Json);
    }
}

public sealed class GetAiFailuresHandler(IAiUsageRepository usage, IRecipientResolver directory)
    : IRequestHandler<GetAiFailuresQuery, IReadOnlyList<AiFailureDto>>
{
    public async Task<IReadOnlyList<AiFailureDto>> Handle(GetAiFailuresQuery q, CancellationToken ct)
    {
        var since = DateTime.UtcNow.AddDays(-Math.Clamp(q.Days, 1, 90));
        var rows = await usage.GetFailuresAsync(q.TenantId, since, Math.Clamp(q.Take, 1, 500), ct);
        var names = await ActivityNames.ResolveAsync(directory, q.TenantId, rows.Select(r => r.UserId ?? ""), ct);
        return rows.Select(r => new AiFailureDto(r.Id, r.UserId, r.UserId is null ? null : names.GetValueOrDefault(r.UserId), r.Purpose, r.Model, r.LatencyMs, r.Error, AiDates.Utc(r.CreatedAt))).ToList();
    }
}

/// <summary>User ids → display names through the directory; ids that are not numbers or not found stay unnamed.</summary>
internal static class ActivityNames
{
    public static async Task<IReadOnlyDictionary<string, string>> ResolveAsync(IRecipientResolver directory, long tenantId, IEnumerable<string> userIds, CancellationToken ct)
    {
        var ids = userIds.Select(u => long.TryParse(u, out var id) ? id : (long?)null).Where(id => id is not null).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<string, string>();
        var users = await directory.ResolveAsync(tenantId, ids, [], ct);
        return users.ToDictionary(u => u.UserId.ToString(), u => string.IsNullOrWhiteSpace(u.Name) ? u.Email : u.Name!);
    }
}
