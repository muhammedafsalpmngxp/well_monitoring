using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.Knowledge;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

/// <summary>
/// Ask Data's settings in core.AiSettings (AI Settings → Ask Data & Features): reading them for the page and for the runtime, and
/// checking a save. The runtime keeps no schema, table or column names of its own, so these are the only source.
/// </summary>
public static partial class AskDataSettingsRules
{
    public const int MaxRowsMin = 1, MaxRowsMax = 10_000;
    public const int QueryTimeoutMin = 5, QueryTimeoutMax = 600;
    public const int MaxQueriesMin = 1, MaxQueriesMax = 10;
    public const int SqlRetriesMax = 5, VerifyRetriesMax = 3, HistoryTurnsMax = 20;
    public const int MaxSchemas = 50, MaxTables = 1000, MaxColumns = 2000, OrgNameMax = 200, ExportPrefixMax = 40;

    /// <summary>File names start "ask-data-…" when the tenant has not chosen a prefix.</summary>
    public const string DefaultExportPrefix = "ask-data";

    /// <summary>How the Ask your data chatbot answers: deep (planner, verifier; slower, checked) or normal (faster).</summary>
    public const string DeepMode = "deep", NormalMode = "normal";

    /// <summary>The stored mode, read leniently: anything but "normal" is deep, the chatbot's long-standing default.</summary>
    public static string ChatMode(string? stored) =>
        string.Equals(stored?.Trim(), NormalMode, StringComparison.OrdinalIgnoreCase) ? NormalMode : DeepMode;

    private static readonly JsonSerializerOptions JsonOut = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>A JSON array of names; anything else (null, bad JSON) is empty.</summary>
    public static IReadOnlyList<string> ParseList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<string?>>(json)?.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!.Trim()).ToList() ?? [];
        }
        catch (JsonException) { return []; }
    }

    public static AskDataSettingsDto ToDto(AiSettings? s)
    {
        if (s is null)
            return new AskDataSettingsDto(false, [], [], [], 500, 60, 3, 2, 1, 3, null, null, DeepMode, null, null);
        var schemas = ParseList(s.AskDataAllowedSchemas);
        return new AskDataSettingsDto(schemas.Count > 0, schemas, ParseList(s.AskDataExcludedTables), ParseList(s.AskDataExcludedColumns),
            s.AskDataMaxRows, s.AskDataQueryTimeout, s.AskDataMaxQueries, s.AskDataSqlRetries, s.AskDataVerifyRetries, s.AskDataHistoryTurns,
            s.AskDataOrgName, s.AskDataExportPrefix, ChatMode(s.AskDataChatMode), s.ModifiedBy,
            s.ModifiedAt == default ? null : DateTime.SpecifyKind(s.ModifiedAt, DateTimeKind.Utc));
    }

    /// <summary>The settings with the tenant's Ask Data business terms and column names (AI Settings → Ask Data & Features →
    /// Terms & column names), which every Ask Data run applies: the panel's and agents' Ask Data steps.</summary>
    public static async Task<AgentRuntimeAskData> WithKnowledgeAsync(this AgentRuntimeAskData askData, IAiKnowledgeRepository knowledge,
        long tenantId, CancellationToken ct)
    {
        var terms = await knowledge.GetTermsAsync(tenantId, AiSources.AskData, 0, ct) ?? [];
        var notes = await knowledge.GetNotesAsync(tenantId, AiSources.AskData, 0, ct) ?? [];
        return askData with
        {
            Terms = terms.Select(t => new AgentRuntimeTerm(t.Term, AiKnowledgeRules.Synonyms(t.Synonyms), t.ColumnName, t.Value, t.Meaning)).ToList(),
            Notes = notes.Where(n => !string.IsNullOrWhiteSpace(n.ColumnName))
                .Select(n => new AgentRuntimeColumnNote(n.ColumnName!, n.DisplayName, string.IsNullOrWhiteSpace(n.Note) ? null : n.Note)).ToList(),
        };
    }

    /// <summary>What the runtime gets with every Ask Data run. No settings row = not set up (no schemas): it refuses.</summary>
    public static AgentRuntimeAskData ToRuntime(AiSettings? s)
    {
        var d = ToDto(s);
        return new AgentRuntimeAskData(d.AllowedSchemas, d.ExcludedTables, d.ExcludedColumns, d.MaxRows, d.QueryTimeout, d.MaxQueries,
            d.SqlRetries, d.VerifyRetries, d.HistoryTurns, d.OrgName ?? "", string.IsNullOrWhiteSpace(d.ExportPrefix) ? DefaultExportPrefix : d.ExportPrefix,
            d.ChatMode);
    }

    /// <summary>
    /// Checks a save against the Ask Data database's catalog and writes it to <paramref name="s"/>. Throws
    /// InvalidOperationException with every problem found. Allowed schemas must exist in the database; hidden tables and
    /// columns are checked for their shape only, so a name that no longer exists can stay hidden.
    /// </summary>
    public static void Apply(AiSettings s, SaveAskDataSettingsRequest r, AskDataCatalogDto catalog)
    {
        var problems = new List<string>();
        var known = catalog.Schemas.ToDictionary(x => x.Name, x => x.Name, StringComparer.OrdinalIgnoreCase);

        var schemas = Clean(r.AllowedSchemas);
        if (schemas.Count == 0) problems.Add("Choose at least one schema Ask Data may read.");
        if (schemas.Count > MaxSchemas) problems.Add($"Choose at most {MaxSchemas} schemas.");
        var unknown = schemas.Where(x => !known.ContainsKey(x)).ToList();
        if (unknown.Count > 0)
            problems.Add($"These schemas are not in the {catalog.Database} database (or have no tables): {string.Join(", ", unknown)}.");
        schemas = schemas.Select(x => known.TryGetValue(x, out var n) ? n : x).ToList();

        var tables = Clean(r.ExcludedTables);
        if (tables.Count > MaxTables) problems.Add($"Hide at most {MaxTables} tables.");
        var badTables = tables.Where(x => !IsName(x, 1, 2)).ToList();
        if (badTables.Count > 0) problems.Add($"Hidden tables must be written schema.table or table: {Quote(badTables)}.");

        var columns = Clean(r.ExcludedColumns);
        if (columns.Count > MaxColumns) problems.Add($"Hide at most {MaxColumns} columns.");
        var badColumns = columns.Where(x => !IsName(x, 1, 3)).ToList();
        if (badColumns.Count > 0) problems.Add($"Hidden columns must be written schema.table.column, table.column or column: {Quote(badColumns)}.");

        Range(problems, "Rows per query", r.MaxRows, MaxRowsMin, MaxRowsMax);
        Range(problems, "Query time limit (seconds)", r.QueryTimeout, QueryTimeoutMin, QueryTimeoutMax);
        Range(problems, "Queries per question", r.MaxQueries, MaxQueriesMin, MaxQueriesMax);
        Range(problems, "SQL rewrites after an error", r.SqlRetries, 0, SqlRetriesMax);
        Range(problems, "Answer re-checks", r.VerifyRetries, 0, VerifyRetriesMax);
        Range(problems, "Conversation turns remembered", r.HistoryTurns, 0, HistoryTurnsMax);

        var org = string.IsNullOrWhiteSpace(r.OrgName) ? null : r.OrgName.Trim();
        if (org is { Length: > OrgNameMax }) problems.Add($"The organisation name must be under {OrgNameMax} characters.");
        var prefix = string.IsNullOrWhiteSpace(r.ExportPrefix) ? null : r.ExportPrefix.Trim().ToLowerInvariant();
        if (prefix is not null && (prefix.Length > ExportPrefixMax || !PrefixPattern().IsMatch(prefix)))
            problems.Add($"The export file prefix may use only a-z, 0-9 and '-', up to {ExportPrefixMax} characters.");

        // Not sent (an older client): keep deep, the chatbot's default.
        var mode = string.IsNullOrWhiteSpace(r.ChatMode) ? DeepMode : r.ChatMode.Trim().ToLowerInvariant();
        if (mode is not (DeepMode or NormalMode)) problems.Add("The chatbot mode must be deep or normal.");

        if (problems.Count > 0) throw new InvalidOperationException(string.Join(" ", problems));

        s.AskDataAllowedSchemas = JsonSerializer.Serialize(schemas, JsonOut);
        s.AskDataExcludedTables = JsonSerializer.Serialize(tables, JsonOut);
        s.AskDataExcludedColumns = JsonSerializer.Serialize(columns, JsonOut);
        s.AskDataMaxRows = r.MaxRows;
        s.AskDataQueryTimeout = r.QueryTimeout;
        s.AskDataMaxQueries = r.MaxQueries;
        s.AskDataSqlRetries = r.SqlRetries;
        s.AskDataVerifyRetries = r.VerifyRetries;
        s.AskDataHistoryTurns = r.HistoryTurns;
        s.AskDataOrgName = org;
        s.AskDataExportPrefix = prefix;
        s.AskDataChatMode = mode;
    }

    /// <summary>Trimmed, blanks dropped, duplicates (ignoring case) dropped, first spelling kept, order kept.</summary>
    private static List<string> Clean(IReadOnlyList<string>? values) =>
        (values ?? []).Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>One to <paramref name="max"/> dot-separated SQL names without brackets, quotes or separators.</summary>
    private static bool IsName(string value, int min, int max)
    {
        var parts = value.Split('.');
        return parts.Length >= min && parts.Length <= max && parts.All(p => p.Length is > 0 and <= 128 && NamePattern().IsMatch(p));
    }

    private static void Range(List<string> problems, string label, int value, int min, int max)
    {
        if (value < min || value > max)
            problems.Add(string.Create(CultureInfo.InvariantCulture, $"{label} must be from {min} to {max:N0}."));
    }

    private static string Quote(IEnumerable<string> values) => string.Join(", ", values.Take(5).Select(v => $"\"{v}\""));

    [GeneratedRegex(@"^[\p{L}\p{N}_][\p{L}\p{N}_ $#@-]*$")]
    private static partial Regex NamePattern();

    [GeneratedRegex(@"^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex PrefixPattern();
}
