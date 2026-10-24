using MediatR;
using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

public sealed class GetAskDataSettingsHandler(IAiSettingsRepository settings) : IRequestHandler<GetAskDataSettingsQuery, AskDataSettingsDto>
{
    public async Task<AskDataSettingsDto> Handle(GetAskDataSettingsQuery q, CancellationToken ct) =>
        AskDataSettingsRules.ToDto(await settings.GetAsync(q.TenantId, ct));
}

/// <summary>The suggested first questions: the admin's list (AI Prompts → Ask Data → Suggested first questions) when it
/// has any, otherwise the questions Ask Data builds from the data.</summary>
public sealed class GetAskDataStartersHandler(IAiAskService ask, IAiSettingsRepository settings, IAiKnowledgeRepository knowledge,
    IAgentRuntimeClient runtime, IMemoryCache cache, IAiPromptStore prompts) : IRequestHandler<GetAskDataStartersQuery, IReadOnlyList<string>>
{
    public async Task<IReadOnlyList<string>> Handle(GetAskDataStartersQuery q, CancellationToken ct)
    {
        if (!await ask.FeatureOnAsync(q.TenantId, AiFeatureCatalog.Ask, ct)) return [];
        var chosen = AiPrompts.StarterQuestions((await prompts.GetAsync(q.TenantId, ct)).GetValueOrDefault(AiPrompts.AskDataStarters));
        if (chosen.Count > 0) return chosen;
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(q.TenantId, ct)).WithKnowledgeAsync(knowledge, cache, q.TenantId, ct);
        if (askData.AllowedSchemas.Count == 0) return [];
        try { return await runtime.AskDataStartersAsync(askData, ct); }
        // Suggestions are optional: without the runtime (or an Ask Data connection) the panel shows none.
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            return [];
        }
    }
}

public sealed class GetAskDataCatalogHandler(IAskDataCatalogReader catalog) : IRequestHandler<GetAskDataCatalogQuery, AskDataCatalogDto>
{
    public Task<AskDataCatalogDto> Handle(GetAskDataCatalogQuery q, CancellationToken ct) => catalog.ReadAsync(ct);
}
