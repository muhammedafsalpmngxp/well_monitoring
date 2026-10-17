using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.DatasetPrompts;

public sealed class GetAiDatasetPromptsHandler(IAiPromptStore prompts, IAiKnowledgeRepository knowledge)
    : IRequestHandler<GetAiDatasetPromptsQuery, IReadOnlyList<AiPromptDto>>
{
    public async Task<IReadOnlyList<AiPromptDto>> Handle(GetAiDatasetPromptsQuery q, CancellationToken ct) =>
        AiPrompts.ToDatasetDtos(
            await prompts.GetAsync(q.TenantId, ct),
            await knowledge.GetDatasetPromptsAsync(q.TenantId, q.SourceType, q.SourceId, ct));
}
