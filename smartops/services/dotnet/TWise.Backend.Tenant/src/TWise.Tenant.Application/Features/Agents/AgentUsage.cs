using System.Globalization;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>
/// Ties core.AiUsageLog rows to the agent and run that made them, without a schema change: the purpose column
/// (40 characters) holds "agent:&lt;agentId&gt;:&lt;runId&gt;", agentId 0 for an agent tested before it was saved.
/// Rows logged before this existed say just "agent" and belong to no agent.
/// </summary>
public static class AgentUsage
{
    public const string Prefix = "agent:";
    private const int PurposeMaxLength = 40;   // core.AiUsageLog.purpose

    /// <summary>Ids up to 16 digits each fit; anything longer is logged untagged rather than failing the insert.</summary>
    public static string Purpose(long? agentId, long runId)
    {
        var tagged = string.Create(CultureInfo.InvariantCulture, $"{Prefix}{agentId ?? 0}:{runId}");
        return tagged.Length <= PurposeMaxLength ? tagged : "agent";
    }

    public static bool TryParse(string purpose, out long agentId, out long runId)
    {
        agentId = runId = 0;
        if (!purpose.StartsWith(Prefix, StringComparison.Ordinal)) return false;
        var parts = purpose[Prefix.Length..].Split(':');
        return parts.Length == 2
            && long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out agentId)
            && long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out runId);
    }

    /// <summary>Totals over grouped rows; null when there are none.</summary>
    public static AiLlmUsageDto? Summarise(IEnumerable<AgentUsageRow> rows)
    {
        var list = rows.ToList();
        if (list.Count == 0) return null;
        var models = list.GroupBy(r => string.IsNullOrWhiteSpace(r.Model) ? "unknown" : r.Model)
            .Select(g => new AiModelUsageDto(g.Key, g.Sum(r => r.Calls), g.Sum(r => r.PromptTokens), g.Sum(r => r.CompletionTokens)))
            .OrderByDescending(m => m.Calls).ThenBy(m => m.Model, StringComparer.Ordinal).ToList();
        return new AiLlmUsageDto(models.Sum(m => m.Calls), models.Sum(m => m.PromptTokens), models.Sum(m => m.CompletionTokens), models);
    }

    /// <summary>Totals per saved agent (agentId 0, unsaved tests, is left out).</summary>
    public static IReadOnlyDictionary<long, AiLlmUsageDto> ByAgent(IEnumerable<AgentUsageRow> rows) =>
        rows.Select(r => (Ok: TryParse(r.Purpose, out var agent, out _), Agent: agent, Row: r))
            .Where(x => x.Ok && x.Agent > 0)
            .GroupBy(x => x.Agent)
            .ToDictionary(g => g.Key, g => Summarise(g.Select(x => x.Row))!);

    /// <summary>Totals per run.</summary>
    public static IReadOnlyDictionary<long, AiLlmUsageDto> ByRun(IEnumerable<AgentUsageRow> rows) =>
        rows.Select(r => (Ok: TryParse(r.Purpose, out _, out var run), Run: run, Row: r))
            .Where(x => x.Ok)
            .GroupBy(x => x.Run)
            .ToDictionary(g => g.Key, g => Summarise(g.Select(x => x.Row))!);
}
