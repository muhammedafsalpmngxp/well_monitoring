using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.PromptLibrary;

/// <summary>Every AI prompt of the tenant (AI Settings → AI Prompts), in catalog order.</summary>
public sealed record GetAiPromptLibraryQuery(long TenantId) : IRequest<IReadOnlyList<AiPromptItemDto>>;

/// <summary>Every saved version of one prompt, newest first.</summary>
public sealed record GetAiPromptHistoryQuery(long TenantId, string Key) : IRequest<IReadOnlyList<AiPromptVersionDto>>;
