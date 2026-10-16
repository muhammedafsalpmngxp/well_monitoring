using System.Text;
using System.Text.RegularExpressions;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Business terms in the ask prompt: every term listed, the ones the question uses marked.</summary>
public static class BusinessTerms
{
    /// <summary>The terms whose name or a synonym appears in the question as whole words.</summary>
    public static IReadOnlyList<AiTerm> Used(IReadOnlyList<AiTerm> terms, string question) =>
        terms.Where(t => Words(t).Any(w => Contains(question, w))).ToList();

    /// <summary>The question with the used terms' words removed, so value matching does not search them.</summary>
    public static string Strip(IReadOnlyList<AiTerm> used, string question) =>
        used.SelectMany(Words).OrderByDescending(w => w.Length)
            .Aggregate(question, (q, w) => Regex.Replace(q, $@"(?<![\p{{L}}\p{{N}}]){Regex.Escape(w)}(?![\p{{L}}\p{{N}}])", " ", RegexOptions.IgnoreCase));

    public static string Describe(IReadOnlyList<AiTerm> terms, IReadOnlyList<AiTerm> used)
    {
        if (terms.Count == 0) return "";
        var sb = new StringBuilder("Business terms (the business's own words; apply the meaning exactly):\n");
        foreach (var t in terms)
        {
            sb.Append("- \"").Append(t.Term).Append('"');
            if (!string.IsNullOrWhiteSpace(t.Synonyms)) sb.Append(" (also: ").Append(t.Synonyms).Append(')');
            sb.Append(": ");
            if (t.ColumnName is not null) sb.Append("filter ").Append(t.ColumnName).Append(" = '").Append(t.Value).Append('\'');
            if (t.ColumnName is not null && t.Meaning is not null) sb.Append(" — ");
            if (t.Meaning is not null) sb.Append(t.Meaning);
            if (used.Contains(t)) sb.Append("   <- used in this question");
            sb.Append('\n');
        }
        return sb.ToString();
    }

    private static IEnumerable<string> Words(AiTerm t) =>
        (t.Synonyms ?? "").Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).Prepend(t.Term);

    private static bool Contains(string text, string phrase) =>
        Regex.IsMatch(text, $@"(?<![\p{{L}}\p{{N}}]){Regex.Escape(phrase)}(?![\p{{L}}\p{{N}}])", RegexOptions.IgnoreCase);
}
