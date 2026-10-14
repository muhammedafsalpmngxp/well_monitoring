using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.AgenticFeatures;

/// <summary>A feature's settings as the Tenant API sends them to the agent runtime: every key, defaults filled in.</summary>
public sealed record FeatureSettingsState(IReadOnlyDictionary<string, JsonElement> Values, FeatureAccessDto Access, bool Customized,
    string? ModifiedBy, DateTime? ModifiedAt);

/// <summary>
/// An Agentic Feature's settings in core.AiSettings.&lt;feature&gt;_settings_json (AI Settings → Ask Data & Features → the feature):
/// reading them with the seed's defaults filled in, and checking a save against the definitions and the Ask Data
/// database's catalog. Stored as {"values": {...}, "access": {...}, "modifiedBy", "modifiedAt"}.
/// </summary>
public static partial class AgenticFeatureSettingsRules
{
    public const int MaxListItems = 500, MaxListItemLength = 400, MaxTextLength = 20_000, MaxTables = 1000, MaxColumns = 2000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string? Stored(AiSettings? s, string feature) => s is null ? null : feature switch
    {
        AgenticFeatureCatalog.Slippage => s.SlippageSettingsJson,
        AgenticFeatureCatalog.DailyReport => s.DailyReportSettingsJson,
        AgenticFeatureCatalog.Anomaly => s.AnomalySettingsJson,
        _ => throw new KeyNotFoundException($"Unknown Agentic Feature '{feature}'."),
    };

    private static void Store(AiSettings s, string feature, string json)
    {
        switch (feature)
        {
            case AgenticFeatureCatalog.Slippage: s.SlippageSettingsJson = json; break;
            case AgenticFeatureCatalog.DailyReport: s.DailyReportSettingsJson = json; break;
            case AgenticFeatureCatalog.Anomaly: s.AnomalySettingsJson = json; break;
            default: throw new KeyNotFoundException($"Unknown Agentic Feature '{feature}'.");
        }
    }

    /// <summary>The stored settings with every key present: a missing or no longer valid stored value is the default.</summary>
    public static FeatureSettingsState Resolve(FeatureSeed feature, string? json)
    {
        JsonObject? stored = null;
        if (!string.IsNullOrWhiteSpace(json))
        {
            try { stored = JsonNode.Parse(json) as JsonObject; }
            catch (JsonException) { stored = null; }
        }
        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        var savedValues = stored?["values"] as JsonObject;
        foreach (var d in feature.Settings)
        {
            var node = savedValues?[d.Key];
            var value = node is null ? d.Default : JsonSerializer.SerializeToElement(node);
            values[d.Key] = node is not null && Check(d, value, out var normal) is null ? normal : d.Default;
        }
        var access = stored?["access"] is JsonObject a
            ? AgenticFeatureCatalog.Access(JsonSerializer.SerializeToElement(a))
            : feature.Access;
        DateTime? at = stored?["modifiedAt"] is JsonValue v && v.TryGetValue<DateTime>(out var t) ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : null;
        return new FeatureSettingsState(values, access, stored is not null, stored?["modifiedBy"]?.GetValue<string>(), at);
    }

    public static AgenticFeatureSettingsDto ToDto(FeatureSeed feature, FeatureSettingsState state) => new(
        feature.Key, feature.Title, feature.Description, feature.AccessMode, feature.Settings, state.Values, state.Access, feature.Access,
        AgenticFeatureCatalog.QueryTables(feature), state.Customized, state.ModifiedBy, state.ModifiedAt);

    /// <summary>
    /// Checks a save and writes it to <paramref name="s"/>. Throws InvalidOperationException listing every problem.
    /// Values not sent keep their current value; unknown keys are refused. Tables and schemas must exist in the Ask Data
    /// database; hidden tables and columns are checked for their shape only (a name may be hidden before it exists).
    /// </summary>
    public static FeatureSettingsState Apply(AiSettings s, FeatureSeed feature, SaveAgenticFeatureSettingsRequest r,
        AskDataCatalogDto catalog, string userId)
    {
        var current = Resolve(feature, Stored(s, feature.Key));
        var problems = new List<string>();
        var values = new Dictionary<string, JsonElement>(current.Values, StringComparer.Ordinal);
        var byKey = feature.Settings.ToDictionary(d => d.Key, StringComparer.Ordinal);
        foreach (var (key, value) in r.Values ?? new Dictionary<string, JsonElement>())
        {
            if (!byKey.TryGetValue(key, out var d)) { problems.Add($"\"{key}\" is not a setting of {feature.Title}."); continue; }
            if (Check(d, value, out var normal) is { } problem) problems.Add($"{d.Label}: {problem}");
            else values[key] = normal;
        }

        var access = CheckAccess(feature, r.Access ?? current.Access, catalog, problems);
        if (problems.Count > 0) throw new InvalidOperationException(string.Join(" ", problems));

        var now = DateTime.UtcNow;
        var doc = new JsonObject
        {
            ["values"] = JsonSerializer.SerializeToNode(values, Json),
            ["access"] = JsonSerializer.SerializeToNode(access, Json),
            ["modifiedBy"] = userId,
            ["modifiedAt"] = now,
        };
        Store(s, feature.Key, doc.ToJsonString(Json));
        return new FeatureSettingsState(values, access, true, userId, now);
    }

    /// <summary>Whether the feature has tables to read: tables mode needs at least one ticked table, schemas mode a
    /// schema or a table.</summary>
    public static bool IsConfigured(FeatureSeed feature, FeatureAccessDto access) =>
        access.IncludedTables.Count > 0 || feature.AccessMode == AgenticFeatureCatalog.AccessSchemas && access.AllowedSchemas.Count > 0;

    /// <summary>Restores the feature's defaults (its column becomes NULL).</summary>
    public static void Reset(AiSettings s, string feature)
    {
        switch (feature)
        {
            case AgenticFeatureCatalog.Slippage: s.SlippageSettingsJson = null; break;
            case AgenticFeatureCatalog.DailyReport: s.DailyReportSettingsJson = null; break;
            case AgenticFeatureCatalog.Anomaly: s.AnomalySettingsJson = null; break;
            default: throw new KeyNotFoundException($"Unknown Agentic Feature '{feature}'.");
        }
    }

    /// <summary>Why a value is not valid for its definition, or null (then <paramref name="normal"/> is the cleaned value).</summary>
    public static string? Check(FeatureSettingDefinitionDto d, JsonElement v, out JsonElement normal)
    {
        normal = v;
        switch (d.Type)
        {
            case "int":
                if (v.ValueKind != JsonValueKind.Number || !v.TryGetInt64(out var i)) return "must be a whole number.";
                return Range(i, d);
            case "decimal":
                if (v.ValueKind != JsonValueKind.Number) return "must be a number.";
                return Range(v.GetDouble(), d);
            case "bool":
                return v.ValueKind is JsonValueKind.True or JsonValueKind.False ? null : "must be on or off.";
            case "enum":
                if (v.ValueKind != JsonValueKind.String || !d.Options.Contains(v.GetString()!)) return $"must be one of {string.Join(", ", d.Options)}.";
                return null;
            case "text":
                if (v.ValueKind != JsonValueKind.String) return "must be text.";
                var text = v.GetString()!;
                var max = (int)(d.Max ?? MaxTextLength);
                if (text.Length > max) return string.Create(CultureInfo.InvariantCulture, $"must be at most {max:N0} characters.");
                return null;
            case "list":
                if (v.ValueKind != JsonValueKind.Array || v.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String)) return "must be a list of texts.";
                var items = v.EnumerateArray().Select(x => x.GetString()!.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.Ordinal).ToList();
                if (items.Count > (d.Max ?? MaxListItems)) return string.Create(CultureInfo.InvariantCulture, $"may hold at most {d.Max ?? MaxListItems:N0} items.");
                if (items.Any(x => x.Length > MaxListItemLength)) return $"each item must be at most {MaxListItemLength} characters.";
                normal = JsonSerializer.SerializeToElement(items);
                return null;
            case "map":
                if (v.ValueKind != JsonValueKind.Object) return "must be a set of named numbers.";
                foreach (var p in v.EnumerateObject())
                {
                    if (p.Name.Trim().Length == 0 || p.Name.Length > 100) return "every name must be 1 to 100 characters.";
                    if (p.Value.ValueKind != JsonValueKind.Number) return $"\"{p.Name}\" must be a number.";
                    if (Range(p.Value.GetDouble(), d) is { } problem) return $"\"{p.Name}\" {problem}";
                }
                return null;
            default:
                return $"has an unknown type '{d.Type}'.";
        }
    }

    private static string? Range(double value, FeatureSettingDefinitionDto d)
    {
        if (d.Min is { } min && value < min || d.Max is { } max && value > max)
            return string.Create(CultureInfo.InvariantCulture, $"must be from {d.Min:0.####} to {d.Max:0.####}.");
        return null;
    }

    private static FeatureAccessDto CheckAccess(FeatureSeed feature, FeatureAccessDto a, AskDataCatalogDto catalog, List<string> problems)
    {
        var schemas = catalog.Schemas.ToDictionary(x => x.Name, StringComparer.OrdinalIgnoreCase);
        var tables = catalog.Schemas.SelectMany(x => x.Tables.Select(t => $"{x.Name}.{t.Name}"))
            .ToDictionary(t => t, StringComparer.OrdinalIgnoreCase);

        var included = Clean(a.IncludedTables);
        var unknownTables = included.Where(t => !tables.ContainsKey(t)).ToList();
        if (unknownTables.Count > 0)
            problems.Add($"These tables are not in the {catalog.Database} database: {Quote(unknownTables)}.");
        if (included.Count > MaxTables) problems.Add($"Choose at most {MaxTables} tables.");
        included = included.Select(t => tables.TryGetValue(t, out var n) ? n : t).ToList();

        var allowed = Clean(a.AllowedSchemas);
        var unknownSchemas = allowed.Where(x => !schemas.ContainsKey(x)).ToList();
        if (unknownSchemas.Count > 0)
            problems.Add($"These schemas are not in the {catalog.Database} database (or have no tables): {Quote(unknownSchemas)}.");
        allowed = allowed.Select(x => schemas.TryGetValue(x, out var n) ? n.Name : x).ToList();

        var excludedTables = Clean(a.ExcludedTables);
        if (excludedTables.Any(t => !IsName(t, 1, 2))) problems.Add("Hidden tables must be written schema.table or table.");
        if (excludedTables.Count > MaxTables) problems.Add($"Hide at most {MaxTables} tables.");
        var excludedColumns = Clean(a.ExcludedColumns);
        if (excludedColumns.Any(c => !IsName(c, 1, 3))) problems.Add("Hidden columns must be written schema.table.column, table.column or column.");
        if (excludedColumns.Count > MaxColumns) problems.Add($"Hide at most {MaxColumns} columns.");

        if (feature.AccessMode == AgenticFeatureCatalog.AccessTables && included.Count == 0)
            problems.Add($"Choose at least one table {feature.Title} may read.");
        if (feature.AccessMode == AgenticFeatureCatalog.AccessSchemas && allowed.Count == 0 && included.Count == 0)
            problems.Add($"Choose at least one schema {feature.Title} may read.");

        return new FeatureAccessDto(allowed, included, excludedTables, excludedColumns);
    }

    private static List<string> Clean(IReadOnlyList<string>? values) =>
        (values ?? []).Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    private static bool IsName(string value, int min, int max)
    {
        var parts = value.Split('.');
        return parts.Length >= min && parts.Length <= max && parts.All(p => p.Length is > 0 and <= 128 && NamePattern().IsMatch(p));
    }

    private static string Quote(IEnumerable<string> values) => string.Join(", ", values.Take(5));

    [GeneratedRegex(@"^[\p{L}\p{N}_][\p{L}\p{N}_ $#@-]*$")]
    private static partial Regex NamePattern();
}
