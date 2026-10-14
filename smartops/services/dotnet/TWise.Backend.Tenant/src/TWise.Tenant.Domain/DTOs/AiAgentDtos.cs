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
/// ExpectedOutput and OutputKey (the answer as {{OutputKey}} in later steps) apply to every step; Model, Temperature
/// and MaxTokens to the built-in ask_ai tool (agentflow AgentSpec / TaskSpec fields). ForEach names the input or
/// output key holding a list: the step runs once per item ({{item}}). Sql is the SELECT a Saved SQL (sql_query)
/// step runs; its {{input}} placeholders are bound as parameters.
/// </summary>
public sealed record AiAgentStepDto(string Text, AiAgentToolDto? Tool = null, string? Id = null, double? X = null, double? Y = null,
    string Kind = "step", string RouteBy = "rules", IReadOnlyList<AiAgentBranchDto>? Branches = null, string? Next = null,
    string? ExpectedOutput = null, string? OutputKey = null, string? Model = null, double? Temperature = null, int? MaxTokens = null,
    string? ForEach = null, int? Retries = null, JsonElement? Options = null, string? Sql = null);

public sealed record AiAgentToolParamDto(string Name, string Type = "str", string? Description = null, bool Required = true);

public sealed record AiAgentToolHeaderDto(string Name, string Value = "");

/// <summary>
/// A Tool node (agentflow ToolSpec): a REST call the model can make. Steps use it as tool { agent: "api", action: Name }.
/// AuthSecret is write-only: send it to set or change the secret, leave it empty to keep the stored one; responses
/// never carry it (HasAuthSecret says whether one is stored).
/// </summary>
public sealed record AiAgentCustomToolDto(string Name, string Url, string? Description = null, IReadOnlyList<AiAgentToolParamDto>? Parameters = null,
    string Method = "GET", IReadOnlyList<AiAgentToolHeaderDto>? Headers = null, string? Body = null, string? ResponsePath = null,
    string AuthScheme = "none", string? AuthSecret = null, bool HasAuthSecret = false, int Timeout = 30);

/// <summary>A sticky note on the canvas: shown in the editor only, never sent to runs or exports.</summary>
public sealed record AiAgentNoteDto(string Id, string Text, double X, double Y, string Color = "yellow");

public sealed record AiAgentInputDto(string Name, string Type = "string", bool Required = true, string? Description = null);

public sealed record AiAgentOutputDto(string Name, string Type = "string", string? Description = null);

/// <summary>
/// Knowledge Source and limits for the built-in Ask Data tool. BusinessRules are added after the tenant's
/// (AI Settings → AI Prompts); blank Examples use the tenant's. AllowedSchemas and MaxRows can only narrow the
/// tenant's Ask Data settings (AI Settings → Ask Data & Features); empty AllowedSchemas = all the tenant allows.
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
    int MaxIterations = 5,
    IReadOnlyList<AiAgentCustomToolDto>? CustomTools = null,
    IReadOnlyList<AiAgentNoteDto>? Notes = null);

/// <summary>One saved version of an agent (newest first in lists).</summary>
public sealed record AiAgentVersionDto(int VersionNo, string Status, string CreatedBy, DateTime CreatedAt);

/// <summary>A trigger: when (Cron in TimeZone, or once at RunOnceAt), the inputs, and who gets the answer by mail.</summary>
public sealed record SaveAiAgentScheduleRequest(string? Cron, DateTime? RunOnceAt = null, string TimeZone = "Asia/Muscat",
    Dictionary<string, string>? Inputs = null, IReadOnlyList<string>? EmailTo = null, bool IsActive = true);

public sealed record AiAgentScheduleDto(long Id, string? Cron, DateTime? RunOnceAt, string TimeZone, IReadOnlyDictionary<string, string> Inputs,
    IReadOnlyList<string> EmailTo, bool IsActive, DateTime? NextRunAt, DateTime? LastRunAt, long? LastRunId, string? LastStatus,
    string CreatedBy, IReadOnlyList<DateTime> NextRuns);

/// <summary>When a cron / once spec would run: the reason it cannot, or the next five times (UTC).</summary>
public sealed record AgentSchedulePreviewRequest(string? Cron, DateTime? RunOnceAt, string TimeZone = "Asia/Muscat");
public sealed record AgentSchedulePreviewDto(string? Problem, IReadOnlyList<DateTime> Next);

/// <summary>An exact eval rule on the answer: contains / not_contains (text, any case) or number (a number in the answer).</summary>
public sealed record AiAgentEvalRuleDto(string Op, string Value);

/// <summary>A test case: inputs, and what a good answer is (Expectation for the model judge and/or Rules).</summary>
public sealed record SaveAiAgentEvalCaseRequest(string Name, Dictionary<string, string>? Inputs = null, string? Expectation = null,
    IReadOnlyList<AiAgentEvalRuleDto>? Rules = null);

public sealed record AiAgentEvalCaseDto(long Id, string Name, IReadOnlyDictionary<string, string> Inputs, string? Expectation,
    IReadOnlyList<AiAgentEvalRuleDto> Rules, string CreatedBy, DateTime UpdatedAt);

/// <summary>One case in an eval run: passed, and why not (rule or judge reasons).</summary>
public sealed record AiAgentEvalResultDto(long CaseId, string Name, bool Passed, IReadOnlyList<string> Reasons, string? Answer,
    long? RunId, double Seconds);

public sealed record AiAgentEvalRunDto(long Id, int? VersionNo, bool Draft, int Passed, int Total, string RunBy, DateTime StartedAt,
    double Seconds, IReadOnlyList<AiAgentEvalResultDto>? Results);

/// <summary>An agent's test cases and its latest eval runs (newest first, without the per-case results).</summary>
public sealed record AiAgentEvalsDto(IReadOnlyList<AiAgentEvalCaseDto> Cases, IReadOnlyList<AiAgentEvalRunDto> Runs);

/// <summary>Run all (or CaseIds) test cases on Agent (the page's draft; null = the saved agent). Draft = it has unsaved changes.</summary>
public sealed record RunAiAgentEvalRequest(SaveAiAgentRequest? Agent = null, bool Draft = false, IReadOnlyList<long>? CaseIds = null);

/// <summary>One of an agent's memories (newest first in lists).</summary>
public sealed record AiAgentMemoryDto(long Id, string Text, long? RunId, DateTime CreatedAt);

/// <summary>LLM calls one model made for an agent or a run, with their tokens.</summary>
public sealed record AiModelUsageDto(string Model, int Calls, long PromptTokens, long CompletionTokens);

/// <summary>
/// LLM use of an agent or one run on the tenant's provider: Ask Data's model calls, routers / supervisor / loop
/// decisions and the combined answer. Models are listed most-used first.
/// </summary>
public sealed record AiLlmUsageDto(int Calls, long PromptTokens, long CompletionTokens, IReadOnlyList<AiModelUsageDto> Models)
{
    public long TotalTokens => PromptTokens + CompletionTokens;
}

/// <summary>One grouped row of core.AiUsageLog for agent runs (purpose agent:&lt;agentId&gt;:&lt;runId&gt;).</summary>
public sealed record AgentUsageRow(string Purpose, string Model, int Calls, long PromptTokens, long CompletionTokens);

/// <summary>Llm is null for agents whose runs predate per-agent usage.</summary>
public sealed record AiAgentStatsDto(int Runs, double? SuccessRate, double? AvgSeconds, DateTime? LastRunAt, AiLlmUsageDto? Llm = null);

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
    IReadOnlyList<AiAgentCustomToolDto> CustomTools,
    string CreatedBy,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    AiAgentStatsDto Stats,
    string AgentState = "active",
    IReadOnlyList<AiAgentNoteDto>? Notes = null);

/// <summary>An admin switches an agent on or off: "active" or "inactive".</summary>
public sealed record SetAiAgentStateRequest(string AgentState);

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
    JsonElement? Steps,
    AiLlmUsageDto? Llm = null,
    int? InputTokens = null,
    int? OutputTokens = null,
    int? TotalTokens = null,
    IReadOnlyList<AgentModelUsage>? Usage = null);

/// <summary>Tokens a run used on one model.</summary>
public sealed record AgentModelUsage(string Model, int Calls, int Input, int Output);

/// <summary>One model's price (USD per 1M tokens) and class (frontier | standard | fast).</summary>
public sealed record AiModelPriceDto(string Model, string ModelClass, decimal InputPer1M, decimal OutputPer1M);

/// <summary>The price catalog, with the active provider's model and fast model (the defaults the estimates use).</summary>
public sealed record AiModelPricesDto(string? ActiveModel, string? FastModel, IReadOnlyList<AiModelPriceDto> Prices);

/// <summary>Runs the configuration as sent (saved or not). AgentId links the run to a saved agent.</summary>
/// <summary>Human Approval: the decision on a waiting run. Token is the one its approval event gave.</summary>
public sealed record ResumeAiAgentRunRequest(string Token, string Decision = "approve", string? Text = null);

/// <summary>ThreadId continues a conversation: the thread's earlier answers are given to the agent.</summary>
public sealed record TestAiAgentRequest(SaveAiAgentRequest Agent, Dictionary<string, string>? Inputs = null, long? AgentId = null,
    string? ThreadId = null);

/// <summary>One earlier turn of a conversation thread.</summary>
public sealed record AgentThreadTurn(string User, string Assistant);

/// <summary>A tool a step can use: the built-in ask_data, or a twise agent, and the actions it accepts.</summary>
public sealed record AgentToolDto(string Agent, string Title, string Description, IReadOnlyList<string> Capabilities, bool Ready);

/// <summary>The tools, or an empty list and why when the agent service cannot be reached.</summary>
public sealed record AgentToolsDto(IReadOnlyList<AgentToolDto> Tools, string? Message);

/// <summary>An agentflow.json v1 (AgenticUIFramework format) turned into an agent for the page, and what could not be used.</summary>
/// <summary>Call one Tool with sample values (the Properties panel's Try it). AgentId fills in the stored secret.</summary>
public sealed record TryAgentToolRequest(AiAgentCustomToolDto Tool, Dictionary<string, JsonElement>? Args = null, long? AgentId = null);

public sealed record AgentFlowImportDto(SaveAiAgentRequest Agent, IReadOnlyList<string> Warnings);

/// <summary>One server-sent event from the agent runtime: step, status, node, done or error.</summary>
public sealed record AgentRuntimeEvent(string Type, JsonElement Data);

/// <summary>The tenant's AI provider handed to the runtime to write a multi-step answer.</summary>
public sealed record AgentRuntimeLlm(string Provider, string BaseUrl, string Model, string? ApiKey, string? FastModel = null);
