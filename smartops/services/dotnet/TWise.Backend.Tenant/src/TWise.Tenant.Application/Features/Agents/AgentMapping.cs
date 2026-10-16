using System.Text.Json;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Entity ↔ DTO for agents; the lists are stored as JSON columns.</summary>
public static class AgentMapping
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static readonly AiAgentStatsDto NoRuns = new(0, null, null, null);

    public const string AskDataTool = "ask_data";

    /// <summary>The agent as the page sends it, for export and runs.</summary>
    public static SaveAiAgentRequest ToRequest(AiAgentDto a) => new(
        a.Name, a.Role, a.Description, a.SystemPrompt, a.Goal, a.Steps, a.Tools, a.Inputs, a.Outputs, a.Status,
        a.AskData, a.Type, a.MaxIterations);

    public static bool UsesAskData(SaveAiAgentRequest r) =>
        r.Tools.Any(t => t.Agent == AskDataTool) || r.Steps.Any(s => s.Tool?.Agent == AskDataTool);

    public static void Apply(AiAgent a, SaveAiAgentRequest r)
    {
        a.Name = r.Name.Trim();
        a.Role = Blank(r.Role);
        a.Description = Blank(r.Description);
        a.SystemPrompt = Blank(r.SystemPrompt);
        a.Goal = Blank(r.Goal);
        a.StepsJson = JsonSerializer.Serialize(r.Steps.Select(s => s with { Text = s.Text.Trim() }), Json);
        a.ToolsJson = JsonSerializer.Serialize(r.Tools, Json);
        a.InputsJson = JsonSerializer.Serialize(r.Inputs ?? [], Json);
        a.OutputsJson = JsonSerializer.Serialize(r.Outputs ?? [], Json);
        a.AskDataJson = r.AskData is null ? null : JsonSerializer.Serialize(r.AskData, Json);
        a.Status = r.Status.Trim().ToLowerInvariant();
        a.Type = r.Type.Trim().ToLowerInvariant();
        a.MaxIterations = r.MaxIterations;
        a.UpdatedAt = DateTime.UtcNow;
    }

    public static AiAgentDto ToDto(AiAgent a, AiAgentStatsDto? stats) => new(
        a.Id, a.Name, a.Role, a.Description, a.SystemPrompt, a.Goal,
        List<AiAgentStepDto>(a.StepsJson), List<AiAgentToolDto>(a.ToolsJson),
        List<AiAgentInputDto>(a.InputsJson), List<AiAgentOutputDto>(a.OutputsJson),
        a.Status, string.IsNullOrWhiteSpace(a.AskDataJson) ? null : JsonSerializer.Deserialize<AiAgentAskDataDto>(a.AskDataJson, Json),
        a.Type, a.MaxIterations, a.CreatedBy, a.CreatedAt, a.UpdatedAt, stats ?? NoRuns);

    public static AiAgentRunDto ToDto(AiAgentRun r) => new(
        r.Id, r.AgentId, r.AgentName, r.RunBy, r.Status, r.Answer, r.Error, r.Seconds, r.StartedAt,
        Element(r.InputsJson), Element(r.StepsJson));

    private static IReadOnlyList<T> List<T>(string json) =>
        string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<T>>(json, Json) ?? [];

    private static JsonElement? Element(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<JsonElement>(json);

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
