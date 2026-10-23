using System.Text.Json;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Stores and reads what the panel showed with an answer (core.AiChatMessages.answer_json).</summary>
public static class AiAnswerSnapshots
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The snapshot as JSON with at most savedRows result rows (TotalRows keeps the real count); null when there is nothing to keep.</summary>
    public static string? ToJson(AiAnswerSnapshot snapshot, int savedRows)
    {
        var result = snapshot.Result is { } r && r.Rows.Count > savedRows ? r with { Rows = r.Rows.Take(savedRows).ToList() } : snapshot.Result;
        var kept = snapshot with { Result = result };
        return kept is { Result: null, Chart: null, Insights: null or { Count: 0 }, Sql: null, FollowUps: null or { Count: 0 } }
            ? null : JsonSerializer.Serialize(kept, Json);
    }

    /// <summary>The stored snapshot, or null for answers saved before it was kept or a value that no longer reads.</summary>
    public static AiAnswerSnapshot? FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<AiAnswerSnapshot>(json, Json); }
        catch (JsonException) { return null; }
    }
}
