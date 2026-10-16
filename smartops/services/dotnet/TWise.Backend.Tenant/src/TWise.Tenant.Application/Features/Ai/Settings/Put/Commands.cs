using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

/// <summary>Daily quota and the on/off flag; enabling needs an active provider (InvalidOperationException otherwise).</summary>
public sealed record SaveAiSettingsCommand(long TenantId, string UserId, SaveAiSettingsRequest Request) : IRequest<AiSettingsDto>;
/// <summary>Saves one AI instruction; empty or default text resets it. Returns every prompt.</summary>
public sealed record SaveAiPromptCommand(long TenantId, string UserId, string Key, string? Text) : IRequest<IReadOnlyList<AiPromptDto>>;
/// <summary>Replaces every feature grant of the tenant.</summary>
public sealed record SaveAiFeatureAccessCommand(long TenantId, IReadOnlyDictionary<string, IReadOnlyList<string>> Access) : IRequest<AiFeatureAccessDto>;
