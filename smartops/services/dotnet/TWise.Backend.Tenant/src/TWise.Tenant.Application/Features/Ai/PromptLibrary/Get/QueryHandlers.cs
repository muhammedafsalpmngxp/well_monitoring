using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.PromptLibrary;

public sealed class GetAiPromptLibraryHandler(IAiPromptStore prompts) : IRequestHandler<GetAiPromptLibraryQuery, IReadOnlyList<AiPromptItemDto>>
{
    public Task<IReadOnlyList<AiPromptItemDto>> Handle(GetAiPromptLibraryQuery q, CancellationToken ct) => prompts.ListAsync(q.TenantId, ct);
}

public sealed class GetAiPromptHistoryHandler(IAiPromptStore prompts) : IRequestHandler<GetAiPromptHistoryQuery, IReadOnlyList<AiPromptVersionDto>>
{
    public Task<IReadOnlyList<AiPromptVersionDto>> Handle(GetAiPromptHistoryQuery q, CancellationToken ct) => prompts.HistoryAsync(q.TenantId, q.Key, ct);
}
