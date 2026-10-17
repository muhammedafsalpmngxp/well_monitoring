using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.PromptLibrary;

public sealed class RestoreAiPromptHandler(IAiPromptStore prompts) : IRequestHandler<RestoreAiPromptCommand, AiPromptItemDto>
{
    public Task<AiPromptItemDto> Handle(RestoreAiPromptCommand c, CancellationToken ct) =>
        prompts.RestoreAsync(c.TenantId, c.Key, c.Request.Version, c.Request.ExpectedVersion, c.Request.Note, c.UserName, ct);
}
