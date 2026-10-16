using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.DatasetPrompts;

public sealed class SaveAiDatasetPromptHandler(IAiKnowledgeRepository knowledge, ISender sender)
    : IRequestHandler<SaveAiDatasetPromptCommand, IReadOnlyList<AiPromptDto>>
{
    public async Task<IReadOnlyList<AiPromptDto>> Handle(SaveAiDatasetPromptCommand c, CancellationToken ct)
    {
        await knowledge.UpsertDatasetPromptAsync(c.TenantId, c.SourceType, c.SourceId, c.Key, c.Text?.Trim(), c.UserId, ct);
        return await sender.Send(new GetAiDatasetPromptsQuery(c.TenantId, c.SourceType, c.SourceId), ct);
    }
}
