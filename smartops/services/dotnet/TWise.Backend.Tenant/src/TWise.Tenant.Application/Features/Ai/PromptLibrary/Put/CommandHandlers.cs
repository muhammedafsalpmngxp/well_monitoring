using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.PromptLibrary;

public sealed class SaveAiPromptVersionHandler(IAiPromptStore prompts) : IRequestHandler<SaveAiPromptVersionCommand, AiPromptItemDto>
{
    public Task<AiPromptItemDto> Handle(SaveAiPromptVersionCommand c, CancellationToken ct) =>
        prompts.SaveAsync(c.TenantId, c.Key, c.Request.Text, c.Request.Note, c.Request.ExpectedVersion, c.UserName, ct);
}
