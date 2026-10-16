using SmartOps.Shared.Db;

namespace SmartOps.Workflow.Domain.Entities;

public class FlowDefinition : AuditableEntity
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string NodesJson { get; set; } = "[]";
    public string EdgesJson { get; set; } = "[]";
    public string Status { get; set; } = "draft";          // draft / published
}

public class Connection : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;       // http / db / queue / smtp
    public string ConfigJson { get; set; } = "{}";
    public string Status { get; set; } = "active";
}

public class AiAgent : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? SystemPrompt { get; set; }
    public string ToolsJson { get; set; } = "[]";
    public string Model { get; set; } = "claude-sonnet-4";
    public string Status { get; set; } = "active";
}

public class AgentRun : AuditableEntity
{
    public int AgentId { get; set; }
    public string? TriggeredBy { get; set; }
    public string InputJson { get; set; } = "{}";
    public string? OutputJson { get; set; }
    public string Status { get; set; } = "running";
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }
}

public class FormDefinition : AuditableEntity
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string SchemaJson { get; set; } = "{}";
    public string UiLayoutJson { get; set; } = "{}";
}

public class CatalogueItem : AuditableEntity
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
}

public class ServiceRequest : AuditableEntity
{
    public int UserId { get; set; }
    public string CatalogueKey { get; set; } = string.Empty;
    public string FormDataJson { get; set; } = "{}";
    public string Status { get; set; } = "submitted";
    public string? AssignedTo { get; set; }
}
