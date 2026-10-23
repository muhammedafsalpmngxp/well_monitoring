using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
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
    /// <summary>Most tables Ask Data may be given: every table of a large reporting database.</summary>
    public const int MaxIncludedTables = 5000;

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
            return new AskDataSettingsDto(false, [], [], [], [], 500, 60, 3, 2, 1, 3, null, null, DeepMode, null, null);
        var schemas = ParseList(s.AskDataAllowedSchemas);
        return new AskDataSettingsDto(schemas.Count > 0, schemas, ParseList(s.AskDataIncludedTables), ParseList(s.AskDataExcludedTables),
            ParseList(s.AskDataExcludedColumns),
            s.AskDataMaxRows, s.AskDataQueryTimeout, s.AskDataMaxQueries, s.AskDataSqlRetries, s.AskDataVerifyRetries, s.AskDataHistoryTurns,
            s.AskDataOrgName, s.AskDataExportPrefix, ChatMode(s.AskDataChatMode), s.ModifiedBy,
            s.ModifiedAt == default ? null : DateTime.SpecifyKind(s.ModifiedAt, DateTimeKind.Utc));
    }

    /// <summary>How long a tenant's Ask Data knowledge is kept between questions: it is 5 reads of the tenant database.</summary>
    public static readonly TimeSpan KnowledgeTtl = TimeSpan.FromSeconds(30);
    /// <summary>Approved examples sent with a run; the runtime picks the few most like the question.</summary>
    public const int MaxExamples = 50;

    private sealed record Knowledge(IReadOnlyList<AgentRuntimeTerm> Terms, IReadOnlyList<AgentRuntimeColumnNote> Notes,
        IReadOnlyList<AgentRuntimeMetric> Metrics, IReadOnlyList<AgentRuntimeExample> Examples, IReadOnlyList<AgentRuntimeLink> Links);

    /// <summary>The settings with the tenant's Ask Data knowledge (AI Settings → Ask Data & Features → Terms & column names):
    /// business terms, column names, metrics, approved examples and confirmed table links. Every Ask Data run applies them
    /// (the panel's and agents' Ask Data steps); changes reach it within <see cref="KnowledgeTtl"/>.</summary>
    public static async Task<AgentRuntimeAskData> WithKnowledgeAsync(this AgentRuntimeAskData askData, IAiKnowledgeRepository knowledge,
        IMemoryCache cache, long tenantId, CancellationToken ct)
    {
        var k = (await cache.GetOrCreateAsync($"askdata-knowledge:{tenantId}", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = KnowledgeTtl;
            return await LoadKnowledgeAsync(knowledge, tenantId, ct);
        }))!;
        return askData with { Terms = k.Terms, Notes = k.Notes, Metrics = k.Metrics, Examples = k.Examples, Links = k.Links };
    }

    private static async Task<Knowledge> LoadKnowledgeAsync(IAiKnowledgeRepository knowledge, long tenantId, CancellationToken ct)
    {
        var terms = await knowledge.GetTermsAsync(tenantId, AiSources.AskData, 0, ct) ?? [];
        var notes = await knowledge.GetNotesAsync(tenantId, AiSources.AskData, 0, ct) ?? [];
        var metrics = await knowledge.GetMetricsAsync(tenantId, AiSources.AskData, 0, ct) ?? [];
        var examples = await knowledge.GetExamplesAsync(tenantId, AiSources.AskData, 0, ct) ?? [];
        var links = await knowledge.GetRelationsAsync(tenantId, ct) ?? [];
        return new Knowledge(
            terms.Select(t => new AgentRuntimeTerm(t.Term, AiKnowledgeRules.Synonyms(t.Synonyms), t.ColumnName, t.Value, t.Meaning)).ToList(),
            notes.Where(n => !string.IsNullOrWhiteSpace(n.ColumnName))
                .Select(n => new AgentRuntimeColumnNote(n.ColumnName!, n.DisplayName, string.IsNullOrWhiteSpace(n.Note) ? null : n.Note)).ToList(),
            metrics.Select(m => new AgentRuntimeMetric(m.Name, m.Agg, m.ColumnName, m.Description)).ToList(),
            examples.Where(e => e.Status == AiExampleStatus.Approved).OrderByDescending(e => e.CreatedAt).Take(MaxExamples)
                .Select(e => ExampleSql(e.QuerySpecJson) is { } sql ? new AgentRuntimeExample(e.Question, sql) : null).OfType<AgentRuntimeExample>().ToList(),
            links.Where(r => r.FromType == AiSources.AskData && r.Status == DatasetRelations.Confirmed)
                .Select(r => new AgentRuntimeLink($"{r.FromName}.{r.FromColumn}", $"{r.ToName}.{r.ToColumn}")).ToList());
    }

    /// <summary>An Ask Data example is stored as {"sql": "..."} in the example's query column (it has no spec).</summary>
    public static string ExampleJson(string sql) => JsonSerializer.Serialize(new { sql });

    public static string? ExampleSql(string? json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json ?? "");
            return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("sql", out var s) && s.ValueKind == JsonValueKind.String
                ? s.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>What the runtime gets with every Ask Data run. No settings row = not set up (no schemas): it refuses.</summary>
    public static AgentRuntimeAskData ToRuntime(AiSettings? s)
    {
        var d = ToDto(s);
        return new AgentRuntimeAskData(d.AllowedSchemas, d.ExcludedTables, d.ExcludedColumns, d.MaxRows, d.QueryTimeout, d.MaxQueries,
            d.SqlRetries, d.VerifyRetries, d.HistoryTurns, d.OrgName ?? "", string.IsNullOrWhiteSpace(d.ExportPrefix) ? DefaultExportPrefix : d.ExportPrefix,
            d.ChatMode, IncludedTables: d.IncludedTables);
    }

    /// <summary>
    /// Checks a save against the Ask Data database's catalog and writes it to <paramref name="s"/>. Throws
    /// InvalidOperationException with every problem found. With a table list (the page ticks the tables Ask Data may read)
    /// every table must exist in the database, the allowed schemas become their schemas and no table is hidden. Without one
    /// (an older client) allowed schemas must exist and hidden tables are checked for their shape only. Hidden columns are
    /// always checked for their shape only, so a name that no longer exists can stay hidden.
    /// </summary>
    public static void Apply(AiSettings s, SaveAskDataSettingsRequest r, AskDataCatalogDto catalog)
    {
        var problems = new List<string>();
        var known = catalog.Schemas.ToDictionary(x => x.Name, x => x.Name, StringComparer.OrdinalIgnoreCase);

        List<string> schemas, tables, included;
        if (r.IncludedTables is not null)
        {
            var inCatalog = catalog.Schemas.SelectMany(x => x.Tables.Select(t => $"{x.Name}.{t.Name}"))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToDictionary(x => x, x => x, StringComparer.OrdinalIgnoreCase);
            included = Clean(r.IncludedTables);
            if (included.Count == 0) problems.Add("Tick at least one table Ask Data may read.");
            if (included.Count > MaxIncludedTables) problems.Add($"Tick at most {MaxIncludedTables:N0} tables.");
            var unknownTables = included.Where(t => !inCatalog.ContainsKey(t)).ToList();
            if (unknownTables.Count > 0)
                problems.Add($"These tables are not in the {catalog.Database} database: {Quote(unknownTables)}.");
            included = included.Select(t => inCatalog.TryGetValue(t, out var n) ? n : t).ToList();
            schemas = included.Select(t => t.Split('.')[0]).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (schemas.Count > MaxSchemas) problems.Add($"Tick tables from at most {MaxSchemas} schemas.");
            tables = [];
        }
        else
        {
            included = [];
            schemas = Clean(r.AllowedSchemas);
            if (schemas.Count == 0) problems.Add("Choose at least one schema Ask Data may read.");
            if (schemas.Count > MaxSchemas) problems.Add($"Choose at most {MaxSchemas} schemas.");
            var unknown = schemas.Where(x => !known.ContainsKey(x)).ToList();
            if (unknown.Count > 0)
                problems.Add($"These schemas are not in the {catalog.Database} database (or have no tables): {string.Join(", ", unknown)}.");
            schemas = schemas.Select(x => known.TryGetValue(x, out var n) ? n : x).ToList();

            tables = Clean(r.ExcludedTables);
            if (tables.Count > MaxTables) problems.Add($"Hide at most {MaxTables} tables.");
            var badTables = tables.Where(x => !IsName(x, 1, 2)).ToList();
            if (badTables.Count > 0) problems.Add($"Hidden tables must be written schema.table or table: {Quote(badTables)}.");
        }

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
        s.AskDataIncludedTables = JsonSerializer.Serialize(included, JsonOut);
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
