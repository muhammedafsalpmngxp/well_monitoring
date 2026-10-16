using System.Text.Json;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// The AI instructions an admin can change per tenant (SuperSonic lets each agent's prompt be edited).
/// Only the wording is editable: the JSON query format, the dataset facts and the checked numbers are
/// always added by code, so an edit cannot break parsing. An empty text means the default.
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
    public const string SqlReview = "sql-review";
    public const int MaxLength = 4000;
    /// <summary>Keys an admin may also set per dataset; the rest are tenant-wide only.</summary>
    public static readonly string[] DatasetKeys = [AskRules, Answer, Report, AlertMessage];

    public static readonly IReadOnlyList<AiPromptDef> All =
    [
        new(AskRules, "Extra rules for questions", "Added to the instructions that turn a question into a query, e.g. \"A year means the fiscal year starting 1 April\". The query format itself cannot be changed.", ""),
        new(Answer, "Answer style", "How the AI words an answer from the result rows.",
            "You are a concise data analyst. Answer the user's question in 1-3 plain sentences using only the result rows given. Mention key numbers. Do not repeat the table. No markdown headings."),
        new(ChartSummary, "Explain a chart", "How the AI explains one chart's data.",
            "You are a concise business analyst. Explain the chart data in 3-5 plain sentences: the headline, the biggest and smallest values with their numbers, any clear trend or outlier, and one practical observation. Use only the data given. No markdown, no bullet points, no headings."),
        new(DashboardSummary, "Explain a dashboard", "How the AI briefs a whole dashboard.",
            "You are a concise business analyst briefing a manager on a dashboard. Write plain prose, no markdown, no bullet points, no headings: " +
            "one headline sentence for the whole dashboard, then one sentence per chart with its key number, then one closing observation that connects two or more charts. Use only the data given."),
        new(Report, "Insight report recommendations", "How the AI turns the checked findings of an insight report (trend, anomalies) into recommendations.",
            "You are a data analyst. From the checked findings about a query result, write at most 3 recommendations, each one plain sentence saying what to check or investigate in the data and why, grounded in a finding. " +
            "Never invent causes, never recommend business actions such as increasing output, never repeat a finding as a recommendation. Give none when nothing stands out."),
        new(Filters, "Suggest dashboard filters", "What makes a good dashboard-wide filter when the AI recommends filters for a dashboard.",
            "You recommend dashboard-wide filters for a BI dashboard. Good filters are categorical columns with a small number of distinct values (2-50) that a viewer would want to slice every chart by: " +
            "region, status, category, type, year/month, owner. Never suggest identifiers, free text, amounts or columns with one distinct value. Prefer columns that appear in several charts."),
        new(ChartEdit, "Edit chart by chat", "How the AI reads a chart-edit instruction. The allowed fields and the reply format cannot be changed.",
            "You edit a chart configuration from a user's instruction. \"top 5 by X\" means limitCategory top, topN 5, and yAggColumn X when X is a column name (prefer an exact column-name match, e.g. the Total column for 'by total') with Sum (F) unless another function is named. " +
            "If the instruction cannot be done with these fields, return an empty patch and say why in message."),
        new(ChartSuggest, "Suggest charts and dashboards", "How the AI picks chart types when it proposes charts for a dataset or designs a dashboard from a prompt.",
            "Use line for date/month/year on the x axis, pie only when the x column has at most 6 distinct values, bar otherwise; table when nothing aggregates well. " +
            "Make the suggestions different from each other; together they should give an overview (a trend, a breakdown, a ranking, a share)."),
        new(Extract, "Learn dataset notes", "What the AI may propose as a dataset note after an answered question (Learning feature).",
            "You extract durable business knowledge about a dataset from one answered question. Only include facts that are NOT already known and that would help answer future questions " +
            "(what a column means, units, code values, how a term maps to a column). Never restate the question, never include figures from the result, never guess."),
        new(Review, "Review answers", "How the AI judges whether a query answered the question before it is kept as an example (Learning feature).",
            "You check whether a query correctly answers a question about a dataset. Judge the query, not the data: right columns, right aggregation, right filters. " +
            "Any business terms and value hints given are the organisation's own definitions of words in this question; a filter that applies them answers the question. " +
            "Do not ask for filters the question does not mention. Say bad only when the query would give a wrong or misleading number for the question."),
        new(Deck, "Slide deck narrative", "How the AI writes the speaker text of an exported slide deck: a headline, bullets and a takeaway per chart, and a closing slide.",
            "You are a business analyst writing the narrative for a slide deck built from a dashboard. For each chart give a slide title of at most 8 words, 2-4 short bullets with the key numbers, and one takeaway sentence. " +
            "Open with a one-sentence headline for the whole dashboard and end with a closing slide of 2-3 sentences that connects the charts. Use only the data given; no markdown."),
        new(SqlReview, "SQL review", "How the AI explains a view's SQL and proposes a faster equivalent. The plan facts and the reply format are added by code.",
            "You are a senior SQL Server performance engineer reviewing a read-only query that feeds a BI view. Explain in plain language what it returns (3-5 sentences). " +
            "List concrete issues ranked by impact, each tied to a line of the query or a plan fact: scans on large tables, functions on filtered columns, SELECT *, implicit conversions, missing join conditions, non-sargable predicates, unnecessary DISTINCT or subqueries. " +
            "Give practical suggestions (indexes with exact columns, rewrites). Propose an optimised query only when it returns exactly the same rows and columns; otherwise leave it empty and say why."),
        new(AlertMessage, "Alert message", "How the AI words the notification and e-mail when an alert starts firing. The checked result is always included after it.",
            "You write the notification for a data alert that has just started firing. In at most two plain sentences say what was found and what to look at first, using only the facts given and quoting the numbers exactly. " +
            "No greeting, no markdown, never invent causes."),
    ];

    public static bool IsKnown(string key) => All.Any(p => p.Key == key);

    /// <summary>The tenant's custom texts by key; bad or missing JSON means none.</summary>
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
        return All.Where(p => DatasetKeys.Contains(p.Key)).Select(p =>
        {
            var tenantText = Text(p.Key, tenant);
            return new AiPromptDto(p.Key, p.Name, p.Description, tenantText, own.TryGetValue(p.Key, out var t) ? t : tenantText, own.ContainsKey(p.Key));
        }).ToList();
    }

    /// <summary>The custom text when set, else the default.</summary>
    public static string Text(string key, IReadOnlyDictionary<string, string> custom) =>
        custom.TryGetValue(key, out var t) && !string.IsNullOrWhiteSpace(t) ? t : All.First(p => p.Key == key).Default;

    public static IReadOnlyList<AiPromptDto> ToDtos(IReadOnlyDictionary<string, string> custom) =>
        All.Select(p => new AiPromptDto(p.Key, p.Name, p.Description, p.Default, Text(p.Key, custom), custom.ContainsKey(p.Key))).ToList();

    /// <summary>Applies one edit and returns the JSON to store (null when nothing is custom). Empty or default text resets.</summary>
    public static string? Save(string? json, string key, string? text)
    {
        if (!IsKnown(key)) throw new InvalidOperationException($"Unknown prompt '{key}'.");
        var t = (text ?? "").Trim();
        if (t.Length > MaxLength) throw new InvalidOperationException($"Keep the text under {MaxLength} characters.");
        var custom = new Dictionary<string, string>(Parse(json));
        if (t.Length == 0 || t == All.First(p => p.Key == key).Default) custom.Remove(key); else custom[key] = t;
        return custom.Count == 0 ? null : JsonSerializer.Serialize(custom);
    }
}

public record AiPromptDef(string Key, string Name, string Description, string Default);
