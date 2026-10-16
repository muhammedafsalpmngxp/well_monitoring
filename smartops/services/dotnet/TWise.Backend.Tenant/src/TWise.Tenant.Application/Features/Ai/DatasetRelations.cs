using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Finds likely links between datasets without AI: two columns with the same normalised name
/// (well_code ≈ WellCode ≈ "Well Code") whose sample values overlap enough. Identifier-like columns
/// (codes, ids, names) make links; measures and dates do not.
/// </summary>
public static class DatasetRelations
{
    public const string Suggested = "suggested";
    public const string Confirmed = "confirmed";
    public const string Rejected = "rejected";
    /// <summary>Share of one column's sample values that must appear in the other for a suggestion.</summary>
    public const double MinOverlap = 0.3;
    public const int MaxDatasetsPerScan = 40;
    private static readonly string[] SkipWords = ["date", "time", "year", "month", "day", "amount", "total", "count", "sum", "avg", "hours", "qty", "quantity", "price", "cost", "value", "percent", "rate", "status", "remarks", "description", "comment"];

    public static bool IsStatus(string s) => s is Suggested or Confirmed or Rejected;

    /// <summary>"well_code", "WellCode", "Well Code" and "well-code" all become "wellcode".</summary>
    public static string Normalise(string column) => new(column.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    /// <summary>Columns worth linking on: not dates, measures or free text by name.</summary>
    public static bool IsKeyLike(string column)
    {
        var n = Normalise(column);
        return n.Length >= 2 && !SkipWords.Any(w => n.Contains(w));
    }

    /// <summary>Share of a's distinct values found in b (0–1); 0 when either side is empty.</summary>
    public static double Overlap(IEnumerable<string> a, IEnumerable<string> b)
    {
        var sa = a.Where(v => v.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sb = b.Where(v => v.Length > 0).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return sa.Count == 0 || sb.Count == 0 ? 0 : (double)sa.Count(v => sb.Contains(v)) / sa.Count;
    }

    /// <summary>Distinct non-empty text values of a column from the loaded rows.</summary>
    public static IReadOnlyList<string> Values(TableDataDto data, string column) =>
        data.Rows.Select(r => r.GetValueOrDefault(column)?.ToString()?.Trim() ?? "").Where(v => v.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>
    /// The confirmed links of one dataset as a prompt block, so the AI can say which dataset has what
    /// a question asks for instead of guessing. Empty when none.
    /// </summary>
    public static string Describe(IReadOnlyList<AiDatasetRelation> all, string sourceType, long sourceId)
    {
        var lines = all.Where(r => r.Status == Confirmed)
            .Select(r => r.FromType == sourceType && r.FromId == sourceId ? $"- {r.ToName} (shares {r.FromColumn} with this dataset's {r.ToColumn})"
                       : r.ToType == sourceType && r.ToId == sourceId ? $"- {r.FromName} (shares {r.ToColumn} with this dataset's {r.FromColumn})" : null)
            .Where(l => l is not null).Distinct().ToList();
        return lines.Count == 0 ? "" : "Related datasets (when this dataset lacks what the question asks for, name the related dataset in the missing message):\n" + string.Join("\n", lines) + "\n";
    }
}
