using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.DatasetPrompts;

/// <summary>The dataset-level AI instructions (AiPrompts.DatasetKeys) with the tenant text as default.</summary>
public sealed record GetAiDatasetPromptsQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<AiPromptDto>>;
