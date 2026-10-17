using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

public sealed class GetAiSettingsHandler(IAiSettingsRepository settings, IAiProviderRepository providers) : IRequestHandler<GetAiSettingsQuery, AiSettingsDto>
{
    public async Task<AiSettingsDto> Handle(GetAiSettingsQuery q, CancellationToken ct) =>
        AiMapping.ToDto(await settings.GetAsync(q.TenantId, ct), (await providers.GetActiveAsync(q.TenantId, ct))?.Id);
}

public sealed class ListAiProvidersHandler(IAiProviderRepository providers) : IRequestHandler<ListAiProvidersQuery, IReadOnlyList<AiProviderDto>>
{
    public async Task<IReadOnlyList<AiProviderDto>> Handle(ListAiProvidersQuery q, CancellationToken ct) =>
        (await providers.ListAsync(q.TenantId, ct)).Select(AiMapping.ToDto).ToList();
}

public sealed class GetAiUsageHandler(IAiSettingsRepository settings, IAiUsageRepository usage) : IRequestHandler<GetAiUsageQuery, AiUsageSummaryDto>
{
    public async Task<AiUsageSummaryDto> Handle(GetAiUsageQuery q, CancellationToken ct)
    {
        var days = Math.Clamp(q.Days, 1, 90);
        var s = await settings.GetAsync(q.TenantId, ct);
        return new AiUsageSummaryDto(await usage.CountTodayAsync(q.TenantId, ct), s?.DailyQuota ?? 0, await usage.GetDailyAsync(q.TenantId, days, ct));
    }
}

public sealed class GetAiFeaturesHandler(IAiSettingsRepository settings, IAiProviderRepository providers, IAiFeatureRoleRepository grants) : IRequestHandler<GetAiFeaturesQuery, AiFeaturesDto>
{
    public async Task<AiFeaturesDto> Handle(GetAiFeaturesQuery q, CancellationToken ct)
    {
        var s = await settings.GetAsync(q.TenantId, ct);
        if (s is not { IsEnabled: true } || await providers.GetActiveAsync(q.TenantId, ct) is null) return new AiFeaturesDto([]);
        var rows = await grants.GetAsync(q.TenantId, ct);
        return new AiFeaturesDto(AiFeatureCatalog.All.Where(f => AiFeatureCatalog.IsAllowed(f.Key, q.Roles, rows)).Select(f => f.Key).ToList());
    }
}

public sealed class GetAiFeatureAccessHandler(IAiFeatureRoleRepository grants) : IRequestHandler<GetAiFeatureAccessQuery, AiFeatureAccessDto>
{
    public async Task<AiFeatureAccessDto> Handle(GetAiFeatureAccessQuery q, CancellationToken ct) =>
        AiFeatureAccessMapping.ToDto(await grants.GetAsync(q.TenantId, ct));
}

/// <summary>The AI-feature prompts in the shape of the former AI instructions list; DefaultText is the original (version 1).</summary>
public sealed class GetAiPromptsHandler(IAiPromptStore prompts) : IRequestHandler<GetAiPromptsQuery, IReadOnlyList<AiPromptDto>>
{
    public async Task<IReadOnlyList<AiPromptDto>> Handle(GetAiPromptsQuery q, CancellationToken ct) =>
        AiPromptMapping.FeatureDtos(await prompts.ListAsync(q.TenantId, ct));
}
