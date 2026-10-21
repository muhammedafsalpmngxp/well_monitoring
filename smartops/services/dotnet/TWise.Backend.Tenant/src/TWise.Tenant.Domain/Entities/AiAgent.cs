namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// An agent built on Agentic AI → Create New Agent: who it is, what it aims for, and the ordered steps
/// it runs, each through a tool (a twise-agentic agent and action). Maps to core.AiAgents.
/// </summary>
public class AiAgent
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string Name { get; set; } = "";
    public string? Role { get; set; }
    public string? Description { get; set; }
    public string? SystemPrompt { get; set; }
    public string? Goal { get; set; }
    public string StepsJson { get; set; } = "[]";
    public string ToolsJson { get; set; } = "[]";
    public string InputsJson { get; set; } = "[]";
    public string OutputsJson { get; set; } = "[]";
    /// <summary>Ask Data options (AiAgentAskDataDto as JSON); null when the agent does not use Ask Data.</summary>
    public string? AskDataJson { get; set; }
    /// <summary>The agent's Tool nodes (REST calls); AuthSecret holds the encrypted secret.</summary>
    public string CustomToolsJson { get; set; } = "[]";
    /// <summary>Canvas sticky notes (editor only).</summary>
    public string NotesJson { get; set; } = "[]";
    /// <summary>draft | published</summary>
    public string Status { get; set; } = "draft";
    /// <summary>active | inactive: an admin switches an agent off (it cannot run) without deleting it.</summary>
    public string AgentState { get; set; } = "active";
    /// <summary>sequential | parallel | supervisor | loop (the AgenticUIFramework's LangGraph process)</summary>
    public string Type { get; set; } = "sequential";
    /// <summary>Supervisor rounds / loop repeats at most.</summary>
    public int MaxIterations { get; set; } = 5;
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>The agent as one save left it (SaveAiAgentRequest JSON, no secrets). Maps to core.AiAgentVersions.</summary>
public class AiAgentVersion
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long AgentId { get; set; }
    public int VersionNo { get; set; }
    public string Status { get; set; } = "draft";
    public string SnapshotJson { get; set; } = "{}";
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A trigger: runs a published agent on a cron (or once) with fixed inputs. Maps to core.AiAgentSchedules.</summary>
public class AiAgentSchedule
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long AgentId { get; set; }
    /// <summary>Five-field cron read in TimeZone; null = once at RunOnceAt.</summary>
    public string? Cron { get; set; }
    public DateTime? RunOnceAt { get; set; }
    public string TimeZone { get; set; } = "Asia/Muscat";
    public string InputsJson { get; set; } = "{}";
    /// <summary>Addresses the answer is mailed to, comma separated; null = none.</summary>
    public string? EmailTo { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? NextRunAt { get; set; }
    public DateTime? LastRunAt { get; set; }
    public long? LastRunId { get; set; }
    /// <summary>success | failed</summary>
    public string? LastStatus { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>An eval test case: inputs and what a good answer is (model judge and/or rules). Maps to core.AiAgentEvalCases.</summary>
public class AiAgentEvalCase
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long AgentId { get; set; }
    public string Name { get; set; } = "";
    public string InputsJson { get; set; } = "{}";
    /// <summary>What a good answer says, judged by the tenant's model; null = rules only.</summary>
    public string? Expectation { get; set; }
    /// <summary>AiAgentEvalRuleDto list as JSON.</summary>
    public string RulesJson { get; set; } = "[]";
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>One "Run all" of an agent's test cases and its score. Maps to core.AiAgentEvalRuns.</summary>
public class AiAgentEvalRun
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long AgentId { get; set; }
    /// <summary>The latest saved version when it ran; Draft = the page had unsaved changes.</summary>
    public int? VersionNo { get; set; }
    public bool Draft { get; set; }
    public int Passed { get; set; }
    public int Total { get; set; }
    /// <summary>AiAgentEvalResultDto list as JSON.</summary>
    public string ResultsJson { get; set; } = "[]";
    public string RunBy { get; set; } = "";
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public double Seconds { get; set; }
}

/// <summary>A fact the agent keeps between runs (Load / Preload Memory). Maps to core.AiAgentMemories.</summary>
public class AiAgentMemory
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long AgentId { get; set; }
    public string Text { get; set; } = "";
    /// <summary>The run it came from.</summary>
    public long? RunId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>One Test Agent run and each step's result. Maps to core.AiAgentRuns.</summary>
public class AiAgentRun
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    /// <summary>Null when an agent was tested before it was first saved.</summary>
    public long? AgentId { get; set; }
    public string AgentName { get; set; } = "";
    public string RunBy { get; set; } = "";
    public string InputsJson { get; set; } = "{}";
    public string? StepsJson { get; set; }
    public string? Answer { get; set; }
    /// <summary>success | failed</summary>
    public string Status { get; set; } = "failed";
    public string? Error { get; set; }
    public double Seconds { get; set; }
    /// <summary>Tokens the run used, per model (AgentModelUsage list as JSON); null for runs before this was kept.</summary>
    public string? UsageJson { get; set; }
    /// <summary>A conversation thread the run belongs to (Test panel "Continue conversation"); null = a single run.</summary>
    public string? ThreadId { get; set; }
    /// <summary>While waiting at Human Approval: the run as sent (no secrets), the paused state and step, to resume it.</summary>
    public string? ResumeJson { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    /// <summary>LLM input (prompt) and output (completion) tokens the run used on the tenant's provider; null when none were recorded.</summary>
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    /// <summary>InputTokens + OutputTokens, stored so reports can read it directly.</summary>
    public int? TotalTokens { get; set; }
}
