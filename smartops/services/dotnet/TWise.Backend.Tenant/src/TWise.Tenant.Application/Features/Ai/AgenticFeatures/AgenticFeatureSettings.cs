using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.AgenticFeatures;

/// <summary>Every Agentic Feature with its settings (AI Settings → Ask Data & Features, one section each).</summary>
public sealed record GetAgenticFeatureSettingsQuery(long TenantId) : IRequest<IReadOnlyList<AgenticFeatureSettingsDto>>;

/// <summary>Saves one feature's settings and the tables it may read; tables and schemas are checked against the Ask Data
/// database. InvalidOperationException lists every problem; KeyNotFoundException for an unknown feature.</summary>
public sealed record SaveAgenticFeatureSettingsCommand(long TenantId, string UserId, string Feature, SaveAgenticFeatureSettingsRequest Request)
    : IRequest<AgenticFeatureSettingsDto>;

/// <summary>Restores one feature's default settings and tables.</summary>
public sealed record ResetAgenticFeatureSettingsCommand(long TenantId, string UserId, string Feature) : IRequest<AgenticFeatureSettingsDto>;

/// <summary>The Agentic Features for the landing page (the caller's permissions filter them in the controller).</summary>
public sealed record ListAgenticFeaturesQuery(long TenantId) : IRequest<IReadOnlyList<AgenticFeatureSummaryDto>>;

public sealed class GetAgenticFeatureSettingsHandler(IAiSettingsRepository settings)
    : IRequestHandler<GetAgenticFeatureSettingsQuery, IReadOnlyList<AgenticFeatureSettingsDto>>
{
    public async Task<IReadOnlyList<AgenticFeatureSettingsDto>> Handle(GetAgenticFeatureSettingsQuery q, CancellationToken ct)
    {
        var s = await settings.GetAsync(q.TenantId, ct);
        return AgenticFeatureCatalog.Keys.Where(AgenticFeatureCatalog.IsKnown).Select(AgenticFeatureCatalog.Get)
            .Select(f => AgenticFeatureSettingsRules.ToDto(f, AgenticFeatureSettingsRules.Resolve(f, AgenticFeatureSettingsRules.Stored(s, f.Key))))
            .ToList();
    }
}

public sealed class SaveAgenticFeatureSettingsHandler(IAiSettingsRepository settings, IAskDataCatalogReader catalog)
    : IRequestHandler<SaveAgenticFeatureSettingsCommand, AgenticFeatureSettingsDto>
{
    public async Task<AgenticFeatureSettingsDto> Handle(SaveAgenticFeatureSettingsCommand c, CancellationToken ct)
    {
        var feature = AgenticFeatureCatalog.Get(c.Feature);
        var known = await catalog.ReadAsync(ct);
        // A tenant without a settings row gets one with AI off: saving a feature's settings does not switch AI on.
        var s = await settings.GetAsync(c.TenantId, ct) ?? new AiSettings { TenantId = c.TenantId, CreatedBy = c.UserId };
        var state = AgenticFeatureSettingsRules.Apply(s, feature, c.Request, known, c.UserId);
        s.ModifiedBy = c.UserId;
        s.ModifiedAt = DateTime.UtcNow;
        await settings.UpsertAsync(s, ct);
        return AgenticFeatureSettingsRules.ToDto(feature, state);
    }
}

public sealed class ResetAgenticFeatureSettingsHandler(IAiSettingsRepository settings)
    : IRequestHandler<ResetAgenticFeatureSettingsCommand, AgenticFeatureSettingsDto>
{
    public async Task<AgenticFeatureSettingsDto> Handle(ResetAgenticFeatureSettingsCommand c, CancellationToken ct)
    {
        var feature = AgenticFeatureCatalog.Get(c.Feature);
        if (await settings.GetAsync(c.TenantId, ct) is { } s && AgenticFeatureSettingsRules.Stored(s, feature.Key) is not null)
        {
            AgenticFeatureSettingsRules.Reset(s, feature.Key);
            s.ModifiedBy = c.UserId;
            s.ModifiedAt = DateTime.UtcNow;
            await settings.UpsertAsync(s, ct);
        }
        return AgenticFeatureSettingsRules.ToDto(feature, AgenticFeatureSettingsRules.Resolve(feature, null));
    }
}

public sealed class ListAgenticFeaturesHandler(IAiSettingsRepository settings)
    : IRequestHandler<ListAgenticFeaturesQuery, IReadOnlyList<AgenticFeatureSummaryDto>>
{
    public async Task<IReadOnlyList<AgenticFeatureSummaryDto>> Handle(ListAgenticFeaturesQuery q, CancellationToken ct)
    {
        var s = await settings.GetAsync(q.TenantId, ct);
        return AgenticFeatureCatalog.Keys.Where(AgenticFeatureCatalog.IsKnown).Select(AgenticFeatureCatalog.Get).Select(f =>
        {
            var state = AgenticFeatureSettingsRules.Resolve(f, AgenticFeatureSettingsRules.Stored(s, f.Key));
            return new AgenticFeatureSummaryDto(f.Key, f.Title, f.Description, AgenticFeatureCatalog.Route(f.Key),
                AgenticFeatureCatalog.ModuleCode(f.Key), s?.IsEnabled == true, AgenticFeatureSettingsRules.IsConfigured(f, state.Access));
        }).ToList();
    }
}
