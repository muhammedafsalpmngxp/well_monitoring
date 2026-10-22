using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

public sealed record GetAiSettingsQuery(long TenantId) : IRequest<AiSettingsDto>;
public sealed record ListAiProvidersQuery(long TenantId) : IRequest<IReadOnlyList<AiProviderDto>>;
/// <summary>Days null = AiAdmin:UsageDays.</summary>
public sealed record GetAiUsageQuery(long TenantId, int? Days) : IRequest<AiUsageSummaryDto>;
/// <summary>What the AI admin screens offer (AiAdmin settings).</summary>
public sealed record GetAiAdminOptionsQuery : IRequest<AiAdminOptionsDto>;
/// <summary>Feature keys a user with these roles may use now (master flag, active provider and grants folded in).</summary>
public sealed record GetAiFeaturesQuery(long TenantId, IReadOnlyList<string> Roles) : IRequest<AiFeaturesDto>;
public sealed record GetAiFeatureAccessQuery(long TenantId) : IRequest<AiFeatureAccessDto>;
public sealed record GetAiPromptsQuery(long TenantId) : IRequest<IReadOnlyList<AiPromptDto>>;
