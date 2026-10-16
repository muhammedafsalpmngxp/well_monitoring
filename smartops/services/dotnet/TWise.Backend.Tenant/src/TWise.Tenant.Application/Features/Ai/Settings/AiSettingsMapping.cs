using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.Settings;

internal static class AiMapping
{
    public static readonly string[] ProviderKinds = ["openai", "anthropic", "azure", "ollama", "custom"];

    public static AiSettingsDto ToDto(AiSettings? s, long? activeId) =>
        s is null ? new AiSettingsDto(500, false, activeId, null) : new AiSettingsDto(s.DailyQuota, s.IsEnabled, activeId, s.ModifiedAt);

    public static AiProviderDto ToDto(AiProvider p) =>
        new(p.Id, p.Name, p.Provider, p.BaseUrl, p.Model, !string.IsNullOrEmpty(p.ApiKeyEncrypted), p.IsActive, p.ModifiedAt, p.FastModel);
}

internal static class AiFeatureAccessMapping
{
    public static AiFeatureAccessDto ToDto(IEnumerable<AiFeatureRole> rows)
    {
        var access = AiFeatureCatalog.All.ToDictionary(f => f.Key,
            f => (IReadOnlyList<string>)rows.Where(r => r.FeatureKey == f.Key).Select(r => r.RoleCode).OrderBy(r => r).ToList());
        return new AiFeatureAccessDto(AiFeatureCatalog.All, access);
    }
}
