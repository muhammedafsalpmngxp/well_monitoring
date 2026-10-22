using FluentValidation;
using MediatR;
using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Application.Features.Ai.Relationships;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.AskDataLinks;

/// <summary>Ask Data's table links live in core.AiDatasetRelations as askdata / 0 on both ends, with the table
/// ("schema.table") as the name and its column as the column; confirmed ones reach every Ask Data run as FK lines.</summary>
internal static class AskDataLinkRules
{
    public static readonly string[] Key = [$"{AiSources.AskData}:0"];

    public static async Task<IReadOnlyList<AiRelationDto>> ListAsync(IAiKnowledgeRepository knowledge, long tenantId, CancellationToken ct) =>
        (await knowledge.GetRelationsAsync(tenantId, ct)).Where(r => r.FromType == AiSources.AskData)
            .Select(GetAiRelationGraphHandler.ToDto).ToList();

    public static AiDatasetRelation New(long tenantId, string from, string to, string status, double? overlap, string userId)
    {
        var (ft, fc) = Split(from);
        var (tt, tc) = Split(to);
        return new AiDatasetRelation
        {
            TenantId = tenantId, FromType = AiSources.AskData, FromId = 0, FromName = ft, FromColumn = fc,
            ToType = AiSources.AskData, ToId = 0, ToName = tt, ToColumn = tc, Status = status, Overlap = overlap, ModifiedBy = userId,
        };
    }

    public static string Full(AiDatasetRelation r, bool from) => from ? $"{r.FromName}.{r.FromColumn}".ToLowerInvariant() : $"{r.ToName}.{r.ToColumn}".ToLowerInvariant();

    private static (string Table, string Column) Split(string full)
    {
        var s = full.Trim();
        var cut = s.LastIndexOf('.');
        return (s[..cut], s[(cut + 1)..]);
    }
}

public sealed class GetAskDataLinksHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAskDataLinksQuery, IReadOnlyList<AiRelationDto>>
{
    public Task<IReadOnlyList<AiRelationDto>> Handle(GetAskDataLinksQuery q, CancellationToken ct) => AskDataLinkRules.ListAsync(knowledge, q.TenantId, ct);
}

public sealed class ScanAskDataLinksHandler(IAiSettingsRepository settings, IAiKnowledgeRepository knowledge, IAgentRuntimeClient runtime, IMemoryCache cache)
    : IRequestHandler<ScanAskDataLinksCommand, IReadOnlyList<AiRelationDto>>
{
    public async Task<IReadOnlyList<AiRelationDto>> Handle(ScanAskDataLinksCommand c, CancellationToken ct)
    {
        var askData = await AskDataSettingsRules.ToRuntime(await settings.GetAsync(c.TenantId, ct)).WithKnowledgeAsync(knowledge, cache, c.TenantId, ct);
        if (askData.AllowedSchemas.Count == 0) throw new InvalidOperationException("Ask Data is not set up: choose its schemas under AI Settings → Ask Data & Features first.");
        IReadOnlyList<AgentRuntimeLinkSuggestion> found;
        try { found = await runtime.AskDataLinksAsync(askData, ct); }
        catch (HttpRequestException) { throw new InvalidOperationException("The agent runtime is not reachable; try again when it is running."); }

        // A pair an admin already confirmed or rejected (either way round) is not suggested again.
        var decided = (await knowledge.GetRelationsAsync(c.TenantId, ct))
            .Where(r => r.FromType == AiSources.AskData && r.Status != DatasetRelations.Suggested)
            .SelectMany(r => new[] { (AskDataLinkRules.Full(r, true), AskDataLinkRules.Full(r, false)), (AskDataLinkRules.Full(r, false), AskDataLinkRules.Full(r, true)) })
            .ToHashSet();
        await knowledge.RemoveSuggestedRelationsAsync(c.TenantId, AskDataLinkRules.Key, ct);
        foreach (var s in found.Where(s => !decided.Contains((s.From.ToLowerInvariant(), s.To.ToLowerInvariant()))))
            await knowledge.AddRelationAsync(AskDataLinkRules.New(c.TenantId, s.From, s.To, DatasetRelations.Suggested, s.Overlap, c.UserId), ct);
        await knowledge.SaveRelationsAsync(ct);
        return await AskDataLinkRules.ListAsync(knowledge, c.TenantId, ct);
    }
}

public sealed class AddAskDataLinkHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<AddAskDataLinkCommand, AiRelationDto>
{
    public async Task<AiRelationDto> Handle(AddAskDataLinkCommand c, CancellationToken ct)
    {
        var relation = AskDataLinkRules.New(c.TenantId, c.Request.From, c.Request.To, DatasetRelations.Confirmed, null, c.UserId);
        await knowledge.AddRelationAsync(relation, ct);
        await knowledge.SaveRelationsAsync(ct);
        return GetAiRelationGraphHandler.ToDto(relation);
    }
}

public sealed class AddAskDataLinkCommandValidator : AbstractValidator<AddAskDataLinkCommand>
{
    public AddAskDataLinkCommandValidator()
    {
        RuleFor(x => x.Request.From).Must(s => AiSources.IsAskDataColumn(s?.Trim(), tableAllowed: false)).WithMessage("Give the from-column as schema.table.column.");
        RuleFor(x => x.Request.To).Must(s => AiSources.IsAskDataColumn(s?.Trim(), tableAllowed: false)).WithMessage("Give the to-column as schema.table.column.");
        RuleFor(x => x.Request).Must(r => !string.Equals(r.From?.Trim(), r.To?.Trim(), StringComparison.OrdinalIgnoreCase)).WithMessage("A link needs two different columns.");
    }
}
