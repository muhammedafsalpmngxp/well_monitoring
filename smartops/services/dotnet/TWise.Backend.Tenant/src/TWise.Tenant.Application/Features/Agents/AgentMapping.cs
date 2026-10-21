using System.Text.Json;
using TWise.Tenant.Application.Abstractions.Services;
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
        a.AskData, a.Type, a.MaxIterations, a.CustomTools, a.Notes);

    public const string AskAiTool = "ask_ai";
    public const string ApiTool = "api";
    public const string UrlContextTool = "url_context";
    public const string ExitLoopTool = "exit_loop";
    /// <summary>Runs a published agent (action = its id) as one step.</summary>
    public const string SubAgentTool = "subagent";
    /// <summary>Checks the answer with the model; on fail the run goes back (options.retryFrom).</summary>
    public const string EvaluatorTool = "evaluator";
    public const string GuardrailTool = "guardrail";
    public const string ComputeTool = "compute";
    public static readonly string[] ComputeModes = ["template", "pick", "math"];
    /// <summary>Pauses the run for a person to approve, edit or reject the latest answer.</summary>
    public const string ApprovalTool = "approval";
    public const int MaxSubAgentDepth = 2;
    /// <summary>Load Memory (matching memories) and Preload Memory (all of them).</summary>
    public static readonly string[] MemoryTools = ["load_memory", "preload_memory"];
    /// <summary>Built-ins that run on the tenant's model.</summary>
    public static readonly string[] ModelTools = [AskAiTool, ApiTool, UrlContextTool, ExitLoopTool, SubAgentTool, EvaluatorTool, .. MemoryTools];

    /// <summary>The tool a step runs with: its own, else the agent's first.</summary>
    public static AiAgentToolDto? ToolOf(SaveAiAgentRequest r, AiAgentStepDto s) => s.Tool ?? r.Tools?.FirstOrDefault();

    /// <summary>The Saved SQL steps: instructions (not routers) whose tool is sql_query.</summary>
    public static IEnumerable<AiAgentStepDto> SqlSteps(SaveAiAgentRequest r) =>
        (r.Steps ?? []).Where(s => s is not null && s.Kind != "router" && ToolOf(r, s)?.Agent == SqlQueryTool);

    /// <summary>Runs read the Ask Data database: Ask Data and Saved SQL steps both get its login.</summary>
    public static bool UsesDatabase(SaveAiAgentRequest r) => UsesAskData(r) || SqlSteps(r).Any();

    /// <summary>A Saved SQL step whose answer the tenant's model writes from its rows (action "summary").</summary>
    public static bool SummarisesSql(SaveAiAgentRequest r) => SqlSteps(r).Any(s => ToolOf(r, s)!.Action == "summary");


    /// <summary>A string option of a step (Options is free JSON); null when missing.</summary>
    public static string? Option(AiAgentStepDto s, string name) =>
        s.Options is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>The agent ids its steps run as sub-agents.</summary>
    public static IEnumerable<string> SubAgentIds(SaveAiAgentRequest r) =>
        r.Tools.Concat(r.Steps.Where(s => s.Tool is not null).Select(s => s.Tool!)).Where(t => t.Agent == SubAgentTool)
            .Select(t => t.Action).Distinct();

    public static bool UsesMemory(SaveAiAgentRequest r) => MemoryTools.Any(t => UsesTool(r, t));

    public static bool UsesTool(SaveAiAgentRequest r, string agent) =>
        r.Tools.Any(t => t.Agent == agent) || r.Steps.Any(s => s.Tool?.Agent == agent);

    public static bool UsesAskData(SaveAiAgentRequest r) => UsesTool(r, AskDataTool);

    public static void Apply(AiAgent a, SaveAiAgentRequest r, IAiKeyProtector keys)
    {
        // Secrets: a new value is encrypted; an empty one keeps what this tool (same name) had stored.
        var stored = List<AiAgentCustomToolDto>(a.CustomToolsJson).ToDictionary(t => t.Name, t => t.AuthSecret);
        a.CustomToolsJson = JsonSerializer.Serialize((r.CustomTools ?? []).Select(t => t with
        {
            AuthSecret = t.AuthScheme == "none" ? null
                : !string.IsNullOrEmpty(t.AuthSecret) ? keys.Protect(t.AuthSecret) : stored.GetValueOrDefault(t.Name),
            HasAuthSecret = false,
        }), Json);
        a.Name = r.Name.Trim();
        a.Role = Blank(r.Role);
        a.Description = Blank(r.Description);
        a.SystemPrompt = Blank(r.SystemPrompt);
        a.Goal = Blank(r.Goal);
        a.StepsJson = JsonSerializer.Serialize(r.Steps.Select(s => s with { Text = s.Text.Trim(), Sql = Blank(s.Sql) }), Json);
        a.ToolsJson = JsonSerializer.Serialize(r.Tools, Json);
        a.InputsJson = JsonSerializer.Serialize(r.Inputs ?? [], Json);
        a.OutputsJson = JsonSerializer.Serialize(r.Outputs ?? [], Json);
        a.NotesJson = JsonSerializer.Serialize(r.Notes ?? [], Json);
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
        a.Type, a.MaxIterations,
        List<AiAgentCustomToolDto>(a.CustomToolsJson).Select(t => t with { HasAuthSecret = t.AuthSecret is not null, AuthSecret = null }).ToList(),
        a.CreatedBy, a.CreatedAt, a.UpdatedAt, stats ?? NoRuns, a.AgentState, List<AiAgentNoteDto>(a.NotesJson));

    public const string Active = "active";
    public const string Inactive = "inactive";

    /// <summary>The tools as the runtime needs them: secrets from the page, else the saved agent's, decrypted.</summary>
    public static IReadOnlyList<AiAgentCustomToolDto>? WithSecrets(IReadOnlyList<AiAgentCustomToolDto>? tools, AiAgent? saved, IAiKeyProtector keys)
    {
        if (tools is null) return null;
        var stored = saved is null ? [] : List<AiAgentCustomToolDto>(saved.CustomToolsJson).Where(t => t.AuthSecret is not null)
            .ToDictionary(t => t.Name, t => t.AuthSecret!);
        return tools.Select(t => t with
        {
            AuthSecret = t.AuthScheme == "none" ? null
                : !string.IsNullOrEmpty(t.AuthSecret) ? t.AuthSecret
                : stored.TryGetValue(t.Name, out var enc) ? keys.Unprotect(enc) : null,
        }).ToList();
    }

    public static AiAgentRunDto ToDto(AiAgentRun r) => new(
        r.Id, r.AgentId, r.AgentName, r.RunBy, r.Status, r.Answer, r.Error, r.Seconds, r.StartedAt,
        Element(r.InputsJson), Element(r.StepsJson), InputTokens: r.InputTokens, OutputTokens: r.OutputTokens,
        TotalTokens: r.TotalTokens, Usage: r.UsageJson is null ? null : List<AgentModelUsage>(r.UsageJson));

    /// <summary>A run's token usage (the runtime's done.usage rows) added up per model.</summary>
    public static IReadOnlyList<AgentModelUsage> Usage(JsonElement done) =>
        done.TryGetProperty("usage", out var rows) && rows.ValueKind == JsonValueKind.Array
            ? rows.EnumerateArray()
                .Where(u => u.ValueKind == JsonValueKind.Object && u.TryGetProperty("model", out var m) && m.ValueKind == JsonValueKind.String)
                .GroupBy(u => u.GetProperty("model").GetString()!)
                .Select(g => new AgentModelUsage(g.Key, g.Sum(u => Int(u, "calls", 1)), g.Sum(u => Int(u, "input")), g.Sum(u => Int(u, "output"))))
                .OrderByDescending(x => x.Input + x.Output).ToList()
            : [];

    private static int Int(JsonElement e, string name, int fallback = 0) =>
        e.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : fallback;

    private static IReadOnlyList<T> List<T>(string json) =>
        string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<T>>(json, Json) ?? [];

    private static JsonElement? Element(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<JsonElement>(json);

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
