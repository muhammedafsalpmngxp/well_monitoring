using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.Settings;

internal static class AiMapping
{
    public static readonly string[] ProviderKinds = ["openai", "anthropic", "azure", "ollama", "custom"];

    /// <summary>Without an active provider the limit shown is the one a new provider would start with.</summary>
    public static AiSettingsDto ToDto(AiSettings? s, AiProvider? active, int defaultQuota) =>
        new(active?.DailyQuota ?? defaultQuota, s?.IsEnabled ?? false, active?.Id, s?.ModifiedAt);

    public static AiProviderDto ToDto(AiProvider p) =>
        new(p.Id, p.Name, p.Provider, p.BaseUrl, p.Model, !string.IsNullOrEmpty(p.ApiKeyEncrypted), p.IsActive, p.ModifiedAt, p.FastModel,
            p.DailyQuota);
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
