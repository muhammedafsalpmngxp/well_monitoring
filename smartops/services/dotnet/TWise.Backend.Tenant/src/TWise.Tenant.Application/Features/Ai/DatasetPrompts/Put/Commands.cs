using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.DatasetPrompts;

/// <summary>Sets one dataset instruction; empty text removes the override. Returns the dataset's prompts.</summary>
public sealed record SaveAiDatasetPromptCommand(long TenantId, string UserId, string SourceType, long SourceId, string Key, string? Text)
    : IRequest<IReadOnlyList<AiPromptDto>>;
