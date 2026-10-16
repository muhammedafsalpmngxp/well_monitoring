using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

public sealed class SaveAiSettingsHandler(IAiSettingsRepository settings, IAiProviderRepository providers) : IRequestHandler<SaveAiSettingsCommand, AiSettingsDto>
{
    public async Task<AiSettingsDto> Handle(SaveAiSettingsCommand c, CancellationToken ct)
    {
        if (c.Request.DailyQuota < 0) throw new InvalidOperationException("Daily quota cannot be negative.");
        var active = await providers.GetActiveAsync(c.TenantId, ct);
        if (c.Request.IsEnabled && active is null)
            throw new InvalidOperationException("Add a provider and mark it active before enabling AI.");

        var s = await settings.GetAsync(c.TenantId, ct) ?? new AiSettings { TenantId = c.TenantId, CreatedBy = c.UserId };
        s.DailyQuota = c.Request.DailyQuota;
        s.IsEnabled = c.Request.IsEnabled;
        s.ModifiedBy = c.UserId;
        s.ModifiedAt = DateTime.UtcNow;
        await settings.UpsertAsync(s, ct);
        return AiMapping.ToDto(s, active?.Id);
    }
}

public sealed class SaveAiPromptHandler(IAiSettingsRepository settings) : IRequestHandler<SaveAiPromptCommand, IReadOnlyList<AiPromptDto>>
{
    public async Task<IReadOnlyList<AiPromptDto>> Handle(SaveAiPromptCommand c, CancellationToken ct)
    {
        var s = await settings.GetAsync(c.TenantId, ct) ?? new AiSettings { TenantId = c.TenantId, CreatedBy = c.UserId };
        s.PromptsJson = AiPrompts.Save(s.PromptsJson, c.Key, c.Text);
        s.ModifiedBy = c.UserId;
        s.ModifiedAt = DateTime.UtcNow;
        await settings.UpsertAsync(s, ct);
        return AiPrompts.ToDtos(AiPrompts.Parse(s.PromptsJson));
    }
}

/// <summary>Replaces the tenant's grants. Unknown feature keys are dropped; role codes are trimmed and de-duplicated.</summary>
public sealed class SaveAiFeatureAccessHandler(IAiFeatureRoleRepository grants) : IRequestHandler<SaveAiFeatureAccessCommand, AiFeatureAccessDto>
{
    public async Task<AiFeatureAccessDto> Handle(SaveAiFeatureAccessCommand c, CancellationToken ct)
    {
        var rows = c.Access
            .Where(kv => AiFeatureCatalog.IsKnown(kv.Key))
            .SelectMany(kv => (kv.Value ?? []).Select(r => r.Trim()).Where(r => r.Length is > 0 and <= 100).Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(r => new AiFeatureRole { TenantId = c.TenantId, FeatureKey = kv.Key, RoleCode = r }))
            .ToList();
        await grants.ReplaceAsync(c.TenantId, rows, ct);
        return AiFeatureAccessMapping.ToDto(rows);
    }
}
