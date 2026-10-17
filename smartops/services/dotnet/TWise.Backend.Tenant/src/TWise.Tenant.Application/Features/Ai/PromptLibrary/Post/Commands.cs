using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.PromptLibrary;

/// <summary>Makes an earlier version (1 = the original) the active one, recorded as a new version.</summary>
public sealed record RestoreAiPromptCommand(long TenantId, string UserName, string Key, RestoreAiPromptRequest Request) : IRequest<AiPromptItemDto>;
