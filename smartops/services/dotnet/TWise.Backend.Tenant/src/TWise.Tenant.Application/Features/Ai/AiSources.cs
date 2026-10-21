namespace TWise.Tenant.Application.Features.Ai;

/// <summary>The dataset kinds Ask AI works on.</summary>
public static class AiSources
{
    public const string Message = "sourceType must be view or import.";
    public static bool IsSourceType(string s) => s is "view" or "import";

    /// <summary>Ask Data's own business terms and column names (no dataset; AI Settings → Ask Data & Features →
    /// Terms & column names) are stored as source type askdata, id 0, the key its conversations use.</summary>
    public const string AskData = "askdata";
    public const string KnowledgeMessage = "sourceType must be view or import, or askdata with id 0 (Ask Data).";
    public static bool IsKnowledgeSource(string s, long id) => IsSourceType(s) || (s == AskData && id == 0);

    /// <summary>An Ask Data note's column: "schema.table" (the table) or "schema.table.column".</summary>
    public static bool IsAskDataColumn(string? s, bool tableAllowed) =>
        s is not null && s.Split('.') is var parts && parts.All(p => p.Trim().Length > 0) && (parts.Length == 3 || (tableAllowed && parts.Length == 2));
}
