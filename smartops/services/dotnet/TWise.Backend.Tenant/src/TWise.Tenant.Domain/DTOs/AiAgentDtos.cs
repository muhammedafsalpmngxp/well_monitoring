using System.Text.Json;

namespace TWise.Tenant.Domain.DTOs;

/// <summary>A twise-agentic agent and one of its actions, e.g. db_assistant / chat.</summary>
public sealed record AiAgentToolDto(string Agent, string Action);

/// <summary>
/// One way out of a router. Rules: Input (an input name, or last_answer) Op Value; Op "else" is the fallback.
/// AI routing uses the Label. Target is the step id to run next, "answer", or null (not wired: the answer).
/// </summary>
public sealed record AiAgentBranchDto(string Id, string? Label = null, string? Input = null, string Op = "equals", string? Value = null, string? Target = null);

/// <summary>
/// One instruction; {{input}} placeholders are filled at run time. Tool defaults to the agent's first tool.
/// Id and X/Y are the canvas node id and position. Kind "router" runs no tool: it picks one of its Branches
/// (RouteBy rules or ai). Next is the step id to run after this one, or "answer"; null = the following step.
/// </summary>
public sealed record AiAgentStepDto(string Text, AiAgentToolDto? Tool = null, string? Id = null, double? X = null, double? Y = null,
    string Kind = "step", string RouteBy = "rules", IReadOnlyList<AiAgentBranchDto>? Branches = null, string? Next = null);

public sealed record AiAgentInputDto(string Name, string Type = "string", bool Required = true, string? Description = null);

public sealed record AiAgentOutputDto(string Name, string Type = "string", string? Description = null);

/// <summary>
/// Knowledge Source and limits for the built-in Ask Data tool. Blank BusinessRules / Examples use the
/// runtime's defaults (the Al-Tasnim rules and example queries); empty AllowedSchemas uses its default list.
/// </summary>
public sealed record AiAgentAskDataDto(string? BusinessRules = null, string? Examples = null,
    IReadOnlyList<string>? AllowedSchemas = null, int MaxRows = 500);

/// <summary>
/// Download the data behind an Ask Data answer (twise db_assistant export): Token is the answer's export_token,
/// Format xlsx or docx. AskData is the agent's Knowledge Source (it sets which tables the check allows).
/// </summary>
public sealed record AskDataExportRequest(string Token, string Format = "xlsx", string? Question = null, string? Answer = null,
    bool Verified = true, AiAgentAskDataDto? AskData = null);

/// <summary>An exported file.</summary>
public sealed record AskDataExportFile(byte[] Body, string ContentType, string FileName);

/// <summary>Body of create, update and test. Status is draft or published.</summary>
public sealed record SaveAiAgentRequest(
    string Name,
    string? Role,
    string? Description,
    string? SystemPrompt,
    string? Goal,
    IReadOnlyList<AiAgentStepDto> Steps,
    IReadOnlyList<AiAgentToolDto> Tools,
    IReadOnlyList<AiAgentInputDto>? Inputs = null,
    IReadOnlyList<AiAgentOutputDto>? Outputs = null,
    string Status = "draft",
    AiAgentAskDataDto? AskData = null,
    string Type = "sequential",
    int MaxIterations = 5);

public sealed record AiAgentStatsDto(int Runs, double? SuccessRate, double? AvgSeconds, DateTime? LastRunAt);

public sealed record AiAgentDto(
    long Id,
    string Name,
    string? Role,
    string? Description,
    string? SystemPrompt,
    string? Goal,
    IReadOnlyList<AiAgentStepDto> Steps,
    IReadOnlyList<AiAgentToolDto> Tools,
    IReadOnlyList<AiAgentInputDto> Inputs,
    IReadOnlyList<AiAgentOutputDto> Outputs,
    string Status,
    AiAgentAskDataDto? AskData,
    string Type,
    int MaxIterations,
    string CreatedBy,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    AiAgentStatsDto Stats);

public sealed record AiAgentRunDto(
    long Id,
    long? AgentId,
    string AgentName,
    string RunBy,
    string Status,
    string? Answer,
    string? Error,
    double Seconds,
    DateTime StartedAt,
    JsonElement? Inputs,
    JsonElement? Steps);

/// <summary>Runs the configuration as sent (saved or not). AgentId links the run to a saved agent.</summary>
public sealed record TestAiAgentRequest(SaveAiAgentRequest Agent, Dictionary<string, string>? Inputs = null, long? AgentId = null);

/// <summary>A tool a step can use: the built-in ask_data, or a twise agent, and the actions it accepts.</summary>
public sealed record AgentToolDto(string Agent, string Title, string Description, IReadOnlyList<string> Capabilities, bool Ready);

/// <summary>The tools, or an empty list and why when the agent service cannot be reached.</summary>
public sealed record AgentToolsDto(IReadOnlyList<AgentToolDto> Tools, string? Message);

/// <summary>An agentflow.json v1 (AgenticUIFramework format) turned into an agent for the page, and what could not be used.</summary>
public sealed record AgentFlowImportDto(SaveAiAgentRequest Agent, IReadOnlyList<string> Warnings);

/// <summary>One server-sent event from the agent runtime: step, status, node, done or error.</summary>
public sealed record AgentRuntimeEvent(string Type, JsonElement Data);

/// <summary>The tenant's AI provider handed to the runtime to write a multi-step answer.</summary>
public sealed record AgentRuntimeLlm(string Provider, string BaseUrl, string Model, string? ApiKey, string? FastModel = null);
