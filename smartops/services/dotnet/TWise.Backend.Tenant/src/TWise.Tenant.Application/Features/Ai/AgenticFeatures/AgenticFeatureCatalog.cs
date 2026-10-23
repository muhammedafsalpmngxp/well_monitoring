using System.Text.Json;
using System.Text.RegularExpressions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AgenticFeatures;

/// <summary>
/// The Agentic Features (Agentic AI → Agentic Features) and what each brings: its settings, the tables it reads by
/// default, its verified SQL, its prompts and (Data Anomaly) its rules. All of it comes from
/// Resources/agentic-features.seed.json, embedded in this assembly: the seed tenants start from. The tenant's own copy
/// lives in its database (core.AiPrompt, core.AiFeatureQuery, core.AnomalyRule, core.AiSettings).
/// </summary>
public static partial class AgenticFeatureCatalog
{
    public const string Slippage = "slippage";
    public const string DailyReport = "dailyreport";
    public const string Anomaly = "anomaly";
    public const string Crew = "crew";

    public const string AccessTables = "tables";
    public const string AccessSchemas = "schemas";

    /// <summary>Permission module codes (control.FeatureModule).</summary>
    public const string LandingModule = "agentic-ai.features";

    public static readonly IReadOnlyList<string> Keys = [Slippage, DailyReport, Anomaly, Crew];

    private static readonly Lazy<IReadOnlyDictionary<string, FeatureSeed>> Seeds = new(Load);

    public static IReadOnlyDictionary<string, FeatureSeed> All => Seeds.Value;

    public static bool IsKnown(string feature) => All.ContainsKey(feature);

    public static FeatureSeed Get(string feature) =>
        All.TryGetValue(feature, out var f) ? f : throw new KeyNotFoundException($"Unknown Agentic Feature '{feature}'.");

    public static string ModuleCode(string feature) => feature switch
    {
        Slippage => "agentic-ai.slippage",
        DailyReport => "agentic-ai.daily-report",
        Anomaly => "agentic-ai.data-anomaly",
        Crew => "agentic-ai.crew-management",
        _ => throw new KeyNotFoundException($"Unknown Agentic Feature '{feature}'."),
    };

    public static string Route(string feature) => feature switch
    {
        Slippage => "slippage",
        DailyReport => "daily-report",
        Anomaly => "data-anomaly",
        Crew => "crew-management",
        _ => throw new KeyNotFoundException($"Unknown Agentic Feature '{feature}'."),
    };

    /// <summary>Every schema.table a feature's verified SQL reads (FROM / JOIN names that are not CTEs), lower case.</summary>
    public static IReadOnlyList<string> QueryTables(FeatureSeed feature) =>
        feature.Queries.SelectMany(q => TablesIn(q.Sql)).Distinct().Order(StringComparer.Ordinal).ToList();

    public static IEnumerable<string> TablesIn(string sql)
    {
        var scrubbed = ScrubPattern().Replace(sql, " ");
        var ctes = CtePattern().Matches(scrubbed).Select(m => Norm(m.Groups[1].Value)).ToHashSet(StringComparer.Ordinal);
        foreach (Match m in TablePattern().Matches(scrubbed))
        {
            var name = Norm(m.Groups[1].Value);
            if (!name.Contains('.'))
            {
                if (ctes.Contains(name)) continue;
                name = "dbo." + name;
            }
            yield return name;
        }
    }

    private static string Norm(string name) =>
        string.Join('.', name.Split('.').Select(p => p.Trim().Trim('[', ']').Trim().ToLowerInvariant()));

    // ── Seed ──────────────────────────────────────────────────────────────────────────────────────────────────────

    private static IReadOnlyDictionary<string, FeatureSeed> Load()
    {
        var asm = typeof(AgenticFeatureCatalog).Assembly;
        var name = asm.GetManifestResourceNames().SingleOrDefault(n => n.EndsWith("agentic-features.seed.json", StringComparison.Ordinal));
        if (name is null) return new Dictionary<string, FeatureSeed>();
        using var stream = asm.GetManifestResourceStream(name)!;
        using var doc = JsonDocument.Parse(stream);
        var result = new Dictionary<string, FeatureSeed>(StringComparer.Ordinal);
        foreach (var f in doc.RootElement.GetProperty("features").EnumerateObject())
        {
            var e = f.Value;
            result[f.Name] = new FeatureSeed(
                f.Name,
                Str(e, "title") ?? f.Name,
                Str(e, "description") ?? "",
                Str(e, "accessMode") ?? AccessTables,
                Array(e, "settings").Select(Setting).ToList(),
                Access(e.TryGetProperty("access", out var a) ? a : default),
                Array(e, "queries").Select(q => new FeatureQuerySeed(Str(q, "key")!, Str(q, "label") ?? Str(q, "key")!,
                    Str(q, "description"), Str(q, "sql")!, Strings(q, "params"), Strings(q, "columns"))).ToList(),
                Array(e, "prompts").Select(p => new FeaturePromptSeed(Str(p, "key")!, Str(p, "name") ?? Str(p, "key")!,
                    Str(p, "description") ?? "", Str(p, "text") ?? "", Strings(p, "replyKeys"),
                    p.TryGetProperty("allowEmpty", out var ae) && ae.ValueKind == JsonValueKind.True)).ToList(),
                Array(e, "rules").Select(r => r.Clone()).ToList());
        }
        return result;
    }

    private static FeatureSettingDefinitionDto Setting(JsonElement s) => new(
        Str(s, "key")!, Str(s, "label") ?? Str(s, "key")!, Str(s, "help") ?? "", Str(s, "group") ?? "General",
        Str(s, "type") ?? "text", s.TryGetProperty("default", out var d) ? d.Clone() : default,
        Num(s, "min"), Num(s, "max"), Strings(s, "options"));

    public static FeatureAccessDto Access(JsonElement a) => a.ValueKind != JsonValueKind.Object
        ? FeatureAccessDto.Empty
        : new FeatureAccessDto(Strings(a, "allowedSchemas"), Strings(a, "includedTables"), Strings(a, "excludedTables"), Strings(a, "excludedColumns"));

    private static IEnumerable<JsonElement> Array(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : [];

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    private static IReadOnlyList<string> Strings(JsonElement e, string name) =>
        Array(e, name).Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList();

    [GeneratedRegex(@"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/", RegexOptions.Singleline)]
    private static partial Regex ScrubPattern();

    [GeneratedRegex(@"\b(?:from|join)\s+((?:\[[^\]]+\]|[A-Za-z_][\w$#@]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][\w$#@]*)){0,2})", RegexOptions.IgnoreCase)]
    private static partial Regex TablePattern();

    [GeneratedRegex(@"(?:\bwith|,)\s*((?:\[[^\]]+\]|[A-Za-z_][\w$#@]*))\s*(?:\([^)]*\))?\s*as\s*\(", RegexOptions.IgnoreCase)]
    private static partial Regex CtePattern();
}

/// <summary>One Agentic Feature as the seed describes it.</summary>
public sealed record FeatureSeed(
    string Key,
    string Title,
    string Description,
    string AccessMode,
    IReadOnlyList<FeatureSettingDefinitionDto> Settings,
    FeatureAccessDto Access,
    IReadOnlyList<FeatureQuerySeed> Queries,
    IReadOnlyList<FeaturePromptSeed> Prompts,
    IReadOnlyList<JsonElement> Rules);

public sealed record FeatureQuerySeed(string Key, string Label, string? Description, string Sql, IReadOnlyList<string> Params,
    IReadOnlyList<string> Columns);

public sealed record FeaturePromptSeed(string Key, string Name, string Description, string Text, IReadOnlyList<string> ReplyKeys,
    bool AllowEmpty);
