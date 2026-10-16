using System.ComponentModel.DataAnnotations;

namespace SmartOps.Workflow.Domain.Dtos;

public record FlowDto(int Id, string Key, string Name, string? Description,
                      object Nodes, object Edges, string Status);

public record FlowUpsertRequest(
    [Required] string Key, [Required] string Name,
    string? Description, object Nodes, object Edges, string Status = "draft");

public record ConnectionDto(int Id, string Name, string Kind, object Config, string Status);

public record AgentDto(int Id, string Name, string? Description, string? SystemPrompt,
                       IReadOnlyList<string> Tools, string Model, string Status);

public record AgentUpsertRequest(
    [Required] string Name, string? Description, string? SystemPrompt,
    IReadOnlyList<string> Tools, string Model = "claude-sonnet-4", string Status = "active");

public record AgentRunDto(int Id, int AgentId, string? TriggeredBy, object Input,
                          object? Output, string Status, DateTime StartedAt, DateTime? FinishedAt);

public record AgentRunRequest([Required] int AgentId, object Input);

public record FormDto(int Id, string Key, string Name, object Schema, object UiLayout);

public record CatalogueDto(int Id, string Key, string Name, string Category,
                           string? Description, string? Icon);

public record RequestDto(int Id, int UserId, string CatalogueKey, object FormData,
                         string Status, string? AssignedTo, DateTime CreatedAt);

public record RequestCreateRequest([Required] string CatalogueKey, object FormData);
