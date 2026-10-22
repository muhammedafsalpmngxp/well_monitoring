using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Activity;

public sealed class GetAiActivityHandler(IAiConversationRepository conversations, IRecipientResolver directory, AiAdminOptions options)
    : IRequestHandler<GetAiActivityQuery, AiActivityPageDto>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<AiActivityPageDto> Handle(GetAiActivityQuery q, CancellationToken ct)
    {
        var (from, to) = ActivityRange.Resolve(q.From, q.To, options);
        var (total, rows) = await conversations.SearchAnswersAsync(q.TenantId, from, to, q.UserId, q.Search, Math.Max(0, q.Skip), ActivityRange.Take(q.Take, options), ct);
        var questions = await conversations.GetQuestionsAsync(rows.Select(r => r.Message.Id).ToList(), ct);
        var names = await ActivityNames.ResolveAsync(directory, q.TenantId, rows.Select(r => r.Conversation.UserId), ct);
        var preview = options.AnswerPreviewLength;
        var items = rows.Select(r =>
        {
            int? totalMs = null;
            if (r.Trace is not null)
                try { totalMs = JsonSerializer.Deserialize<List<AiTraceStep>>(r.Trace.TraceJson, Json)?.Sum(s => s.Ms); } catch (JsonException) { }
            var answer = r.Message.Content;
            return new AiActivityItemDto(r.Message.Id, r.Conversation.Id, r.Conversation.UserId, names.GetValueOrDefault(r.Conversation.UserId),
                r.Conversation.SourceType, r.Conversation.SourceId, r.Conversation.SourceName,
                questions.GetValueOrDefault(r.Message.Id, r.Conversation.Title), answer.Length > preview ? answer[..preview] + "…" : answer,
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

public sealed class GetAiCallsHandler(IAiUsageRepository usage, IRecipientResolver directory, AiAdminOptions options)
    : IRequestHandler<GetAiCallsQuery, AiCallsPageDto>
{
    public async Task<AiCallsPageDto> Handle(GetAiCallsQuery q, CancellationToken ct)
    {
        var (from, to) = ActivityRange.Resolve(q.From, q.To, options);
        var (total, rows) = await usage.SearchAsync(q.TenantId, from, to, q.UserId, q.Purpose, q.FailedOnly, q.Search, Math.Max(0, q.Skip),
            ActivityRange.Take(q.Take, options), ct);
        var (userIds, purposes) = await usage.FacetsAsync(q.TenantId, from, to, ct);
        var names = await ActivityNames.ResolveAsync(directory, q.TenantId, rows.Select(r => r.UserId ?? "").Concat(userIds), ct);
        var items = rows.Select(r => new AiCallDto(r.Id, r.UserId, r.UserId is null ? null : names.GetValueOrDefault(r.UserId), r.Purpose, r.Model,
            r.PromptTokens, r.CompletionTokens, r.LatencyMs, r.Succeeded, r.Error, AiDates.Utc(r.CreatedAt))).ToList();
        var users = userIds.Select(u => new AiActivityUserDto(u, names.GetValueOrDefault(u))).OrderBy(u => u.Name ?? u.UserId, StringComparer.OrdinalIgnoreCase).ToList();
        return new AiCallsPageDto(total, items, users, purposes);
    }
}

/// <summary>The period and page size AI Activity reads, from the request or the AiAdmin settings.</summary>
internal static class ActivityRange
{
    /// <summary>[from, to) in UTC from inclusive days; no dates = the last ActivityDays days. At most MaxDays.</summary>
    public static (DateTime From, DateTime To) Resolve(DateOnly? from, DateOnly? to, AiAdminOptions o)
    {
        var last = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var first = from ?? last.AddDays(-(o.ActivityDays - 1));
        if (first > last) throw new InvalidOperationException("The start date is after the end date.");
        if (last.DayNumber - first.DayNumber + 1 > o.MaxDays) throw new InvalidOperationException($"Choose a period of at most {o.MaxDays} days.");
        return (first.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), last.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
    }

    public static int Take(int? take, AiAdminOptions o) => Math.Clamp(take ?? o.PageSize, 1, o.MaxPageSize);
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
