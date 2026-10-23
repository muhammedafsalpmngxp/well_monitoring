using System.Text.Json;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// The AI features' prompt keys and how a feature reads its text. Every text comes from the tenant database
/// (core.AiPrompt, read through IAiPromptStore and edited under AI Settings → AI Prompts); there are no
/// defaults in code. Only the wording is editable: the JSON query format, the dataset facts and the checked numbers
/// are always added by code, so an edit cannot break parsing.
/// </summary>
public static class AiPrompts
{
    public const string AskRules = "ask-rules";
    public const string Answer = "answer";
    public const string ChartSummary = "chart-summary";
    public const string DashboardSummary = "dashboard-summary";
    public const string Report = "report";
    public const string Filters = "filters";
    public const string ChartEdit = "chart-edit";
    public const string ChartSuggest = "chart-suggest";
    public const string Extract = "extract";
    public const string Review = "review";
    public const string AlertMessage = "alert-message";
    public const string Deck = "deck";
    public const string DeckKeyFigures = "deck-key-figures";
    public const string SqlReview = "sql-review";
    public const string Dictionary = "dictionary";
    /// <summary>Longest per-dataset override (core.AiDatasetPrompts.prompt_text).</summary>
    public const int MaxLength = 4000;
    /// <summary>Keys an admin may also set per dataset; the rest are tenant-wide only.</summary>
    public static readonly string[] DatasetKeys = [AskRules, Answer, Report, AlertMessage];

    /// <summary>A {key: text} JSON object (core.AiSettings.prompts_json from before core.AiPrompt); bad or missing JSON means none.</summary>
    public static IReadOnlyDictionary<string, string> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new Dictionary<string, string>();
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? []; }
        catch (JsonException) { return new Dictionary<string, string>(); }
    }

    /// <summary>
    /// The texts in use for one dataset: the dataset's own text wins; for ask-rules both the tenant's
    /// and the dataset's rules apply, one after the other.
    /// </summary>
    public static IReadOnlyDictionary<string, string> Merge(IReadOnlyDictionary<string, string> tenant, IEnumerable<AiDatasetPrompt> dataset)
    {
        var merged = new Dictionary<string, string>(tenant);
        foreach (var p in dataset.Where(p => DatasetKeys.Contains(p.Key) && !string.IsNullOrWhiteSpace(p.Text)))
            merged[p.Key] = p.Key == AskRules && tenant.TryGetValue(AskRules, out var t) && !string.IsNullOrWhiteSpace(t) ? $"{t}\n{p.Text}" : p.Text;
        return merged;
    }

    /// <summary>The dataset-level prompts: defaultText is the tenant's text in use, text the dataset's override when set.</summary>
    public static IReadOnlyList<AiPromptDto> ToDatasetDtos(IReadOnlyDictionary<string, string> tenant, IEnumerable<AiDatasetPrompt> dataset)
    {
        var own = dataset.ToDictionary(p => p.Key, p => p.Text);
        return DatasetKeys.Select(AiPromptCatalog.Get).Select(p =>
        {
            var tenantText = Text(p.Key, tenant);
            return new AiPromptDto(p.Key, p.Name, p.Description, tenantText, own.TryGetValue(p.Key, out var t) ? t : tenantText, own.ContainsKey(p.Key));
        }).ToList();
    }

    /// <summary>The tenant's text for a prompt. A prompt the tenant does not have is an error, never a built-in default.</summary>
    public static string Text(string key, IReadOnlyDictionary<string, string> texts) =>
        texts.TryGetValue(key, out var t) && t is not null
            ? t
            : throw new InvalidOperationException($"The AI prompt '{key}' is not configured for this tenant. An admin can restore it under AI Settings → AI Prompts.");
}
