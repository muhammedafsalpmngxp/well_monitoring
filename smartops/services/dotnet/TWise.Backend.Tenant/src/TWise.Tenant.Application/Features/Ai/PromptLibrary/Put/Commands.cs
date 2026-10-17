using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.PromptLibrary;

/// <summary>Saves a new version of one prompt. UserName goes into the history (who changed it).</summary>
public sealed record SaveAiPromptVersionCommand(long TenantId, string UserName, string Key, SaveAiPromptVersionRequest Request) : IRequest<AiPromptItemDto>;
