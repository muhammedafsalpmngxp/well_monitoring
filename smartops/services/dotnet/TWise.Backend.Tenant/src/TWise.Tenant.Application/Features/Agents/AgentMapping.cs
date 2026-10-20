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
    /// <summary>Saved SQL: the built-in tool that runs the SELECT written on the step (agent runtime app/sqlstep.py).</summary>
    public const string SqlQueryTool = "sql_query";
    public static readonly string[] SqlQueryActions = ["table", "summary"];
    /// <summary>An input with this name lets people ask in their own words; one fast-model call fills the other inputs.</summary>
    public const string QuestionInput = "question";
    /// <summary>The first step's kind when it runs before the others and its first row sets the inputs (Saved SQL only).</summary>
    public const string SetupKind = "setup";

    /// <summary>The agent takes a question and one was typed in for this run.</summary>
    public static bool HasQuestion(SaveAiAgentRequest r, IReadOnlyDictionary<string, string> inputs) =>
        (r.Inputs ?? []).Any(i => i.Name == QuestionInput) && !string.IsNullOrWhiteSpace(inputs.GetValueOrDefault(QuestionInput));

    /// <summary>The agent as the page sends it, for export and runs.</summary>
    public static SaveAiAgentRequest ToRequest(AiAgentDto a) => new(
        a.Name, a.Role, a.Description, a.SystemPrompt, a.Goal, a.Steps, a.Tools, a.Inputs, a.Outputs, a.Status,
        a.AskData, a.Type, a.MaxIterations);

    public static bool UsesAskData(SaveAiAgentRequest r) =>
        r.Tools.Any(t => t.Agent == AskDataTool) || r.Steps.Any(s => s.Tool?.Agent == AskDataTool);

    /// <summary>The tool a step runs with: its own, else the agent's first.</summary>
    public static AiAgentToolDto? ToolOf(SaveAiAgentRequest r, AiAgentStepDto s) => s.Tool ?? r.Tools?.FirstOrDefault();

    /// <summary>The Saved SQL steps: instructions (not routers) whose tool is sql_query.</summary>
    public static IEnumerable<AiAgentStepDto> SqlSteps(SaveAiAgentRequest r) =>
        (r.Steps ?? []).Where(s => s is not null && s.Kind != "router" && ToolOf(r, s)?.Agent == SqlQueryTool);

    /// <summary>Runs read the Ask Data database: Ask Data and Saved SQL steps both get its login.</summary>
    public static bool UsesDatabase(SaveAiAgentRequest r) => UsesAskData(r) || SqlSteps(r).Any();

    /// <summary>A Saved SQL step whose answer the tenant's model writes from its rows (action "summary").</summary>
    public static bool SummarisesSql(SaveAiAgentRequest r) => SqlSteps(r).Any(s => ToolOf(r, s)!.Action == "summary");

    public static void Apply(AiAgent a, SaveAiAgentRequest r)
    {
        a.Name = r.Name.Trim();
        a.Role = Blank(r.Role);
        a.Description = Blank(r.Description);
        a.SystemPrompt = Blank(r.SystemPrompt);
        a.Goal = Blank(r.Goal);
        a.StepsJson = JsonSerializer.Serialize(r.Steps.Select(s => s with { Text = s.Text.Trim(), Sql = Blank(s.Sql) }), Json);
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
        a.Type, a.MaxIterations, a.CreatedBy, a.CreatedAt, a.UpdatedAt, stats ?? NoRuns, a.AgentState);

    public const string Active = "active";
    public const string Inactive = "inactive";

    public static AiAgentRunDto ToDto(AiAgentRun r) => new(
        r.Id, r.AgentId, r.AgentName, r.RunBy, r.Status, r.Answer, r.Error, r.Seconds, r.StartedAt,
        Element(r.InputsJson), Element(r.StepsJson), InputTokens: r.InputTokens, OutputTokens: r.OutputTokens,
        TotalTokens: r.TotalTokens);

    private static IReadOnlyList<T> List<T>(string json) =>
        string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<T>>(json, Json) ?? [];

    private static JsonElement? Element(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<JsonElement>(json);

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
