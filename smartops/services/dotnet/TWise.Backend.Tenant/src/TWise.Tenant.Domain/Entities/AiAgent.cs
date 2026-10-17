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
    /// <summary>draft | published</summary>
    public string Status { get; set; } = "draft";
    /// <summary>sequential | parallel | supervisor | loop (the AgenticUIFramework's LangGraph process)</summary>
    public string Type { get; set; } = "sequential";
    /// <summary>Supervisor rounds / loop repeats at most.</summary>
    public int MaxIterations { get; set; } = 5;
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
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
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    /// <summary>LLM input (prompt) and output (completion) tokens the run used on the tenant's provider; null when none were recorded.</summary>
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    /// <summary>InputTokens + OutputTokens, stored so reports can read it directly.</summary>
    public int? TotalTokens { get; set; }
}
