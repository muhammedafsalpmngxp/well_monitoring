namespace TWise.Tenant.Application.Features.Ai.Knowledge;

/// <summary>Trimming and limits shared by the knowledge validators and handlers.</summary>
internal static class AiKnowledgeRules
{
    public static readonly string[] Aggregations = ["count", "countDistinct", "sum", "avg", "min", "max"];

    public static string? Clean(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Trim()[..Math.Min(max, s.Trim().Length)];

    public static List<string> Synonyms(string? text) =>
        (text ?? "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}
