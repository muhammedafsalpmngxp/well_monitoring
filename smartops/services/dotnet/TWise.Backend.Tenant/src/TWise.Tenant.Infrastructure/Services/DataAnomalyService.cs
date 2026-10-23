using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Data Anomaly's state in the tenant database (see IDataAnomalyService). Compile, run and discover take minutes, so
/// they are queued in core.AiFeatureJob and run by AgenticJobWorker; the pages poll the job. Rules come from the seed
/// (Resources/agentic-features.seed.json) the first time they are needed, and a newer seed upgrades the rules nobody
/// edited (keeping the status an admin chose).
/// </summary>
public sealed partial class DataAnomalyService(TenantDbContext db, IAiSettingsRepository settings, IAiService ai,
    IAgenticFeatureGateway gateway, IAgenticJobSignal signal, ILogger<DataAnomalyService> logger) : IDataAnomalyService
{
    internal const string Feature = AgenticFeatureCatalog.Anomaly;
    internal const string KindCompile = "compile", KindRun = "run", KindDiscover = "discover";
    internal static readonly string[] Kinds = [KindCompile, KindRun, KindDiscover];
    internal static readonly string[] ReportFormats = ["xlsx", "docx"];
    /// <summary>What an admin may set a rule to; "rejected" is what a rejected proposal stays as.</summary>
    internal static readonly string[] RuleStatuses = ["active", "probation", "draft", "disabled"];
    internal static readonly string[] Severities = ["critical", "high", "medium", "low"];
    private static readonly string[] ProposalStatuses = ["pending", "dropped", "accepted", "rejected"];
    private const string SystemUser = "system";
    private const int MaxRuleIds = 2000, MaxProposals = 50;

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly ConcurrentDictionary<long, bool> Seeded = new();
    private static readonly JsonElement EmptyObject = JsonSerializer.Deserialize<JsonElement>("{}");

    // ── Dashboard ───────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<AnomalyOverviewDto> OverviewAsync(long tenantId, CancellationToken ct)
    {
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var rules = await db.AnomalyRules.AsNoTracking().Where(r => r.TenantId == tenantId)
            .GroupBy(r => r.Status).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var probes = await db.AnomalyProbes.AsNoTracking().Where(p => p.TenantId == tenantId)
            .GroupBy(p => p.Status).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var pending = await db.AnomalyProposals.CountAsync(p => p.TenantId == tenantId && p.Status == "pending", ct);
        var latest = await db.AnomalyRuns.AsNoTracking().Where(r => r.TenantId == tenantId)
            .OrderByDescending(r => r.StartedAt).ThenByDescending(r => r.Id).FirstOrDefaultAsync(ct);
        var jobs = await db.AiFeatureJobs.AsNoTracking().Where(j => j.TenantId == tenantId && j.Feature == Feature)
            .OrderByDescending(j => j.Id).Take(10).ToListAsync(ct);
        var s = await settings.GetAsync(tenantId, ct);
        var seed = AgenticFeatureCatalog.Get(Feature);
        var access = AgenticFeatureSettingsRules.Resolve(seed, AgenticFeatureSettingsRules.Stored(s, Feature)).Access;
        return new AnomalyOverviewDto(
            latest is null ? null : RunSummary(latest, await ReportFormatsAsync(tenantId, latest.RunId, ct)),
            rules, probes, pending,
            jobs.Where(j => AiFeatureJobStatus.IsActive(j.Status)).Select(JobDto).FirstOrDefault(),
            jobs.Where(j => !AiFeatureJobStatus.IsActive(j.Status)).Select(JobDto).FirstOrDefault(),
            AgenticFeatureSettingsRules.IsConfigured(seed, access), s?.IsEnabled == true);
    }

    // ── Rules ───────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AnomalyRuleDto>> RulesAsync(long tenantId, CancellationToken ct)
    {
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var rules = await db.AnomalyRules.AsNoTracking().Where(r => r.TenantId == tenantId).OrderBy(r => r.RuleId).ToListAsync(ct);
        var probes = (await db.AnomalyProbes.AsNoTracking().Where(p => p.TenantId == tenantId).ToListAsync(ct)).ToLookup(p => p.RuleId);
        return rules.Select(r => RuleDto(r, probes[r.RuleId].ToList())).ToList();
    }

    public async Task<AnomalyRuleDto> SetRuleStatusAsync(long tenantId, string ruleId, string? status, string user, CancellationToken ct)
    {
        var value = (status ?? "").Trim().ToLowerInvariant();
        if (!RuleStatuses.Contains(value)) throw new InvalidOperationException($"A rule's status must be one of {string.Join(", ", RuleStatuses)}.");
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var rule = await db.AnomalyRules.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.RuleId == ruleId, ct)
            ?? throw new KeyNotFoundException($"There is no Data Anomaly rule '{ruleId}'.");
        // The status is not part of the definition the seed upgrades: changing it keeps seed_hash.
        rule.Status = value;
        rule.DefinitionJson = WithField(rule.DefinitionJson, "status", value);
        rule.ModifiedBy = user;
        rule.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        var probes = await db.AnomalyProbes.AsNoTracking().Where(p => p.TenantId == tenantId && p.RuleId == ruleId).ToListAsync(ct);
        return RuleDto(rule, probes);
    }

    public async Task<AnomalyRuleDto> CreateRuleAsync(long tenantId, SaveAnomalyRuleRequest request, string user, CancellationToken ct)
    {
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var taken = await db.AnomalyRules.Where(r => r.TenantId == tenantId).Select(r => r.RuleId).ToListAsync(ct);
        var id = string.IsNullOrWhiteSpace(request.RuleId) ? NextUserRuleId(taken) : request.RuleId.Trim();
        if (!RuleIdPattern().IsMatch(id))
            throw new InvalidOperationException("A rule id is 1 to 60 letters, digits, '-', '_' or '.', starting with a letter or digit.");
        if (taken.Contains(id, StringComparer.OrdinalIgnoreCase))
            throw new FeatureConflictException($"A rule with the id '{id}' already exists. Choose another id.");

        var definition = RuleDefinition(null, id, request);
        var row = NewRule(tenantId, JsonSerializer.Deserialize<JsonElement>(definition.ToJsonString(Json)), user, seedHash: null);
        db.AnomalyRules.Add(row);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();   // UQ_core_AnomalyRule_rule: someone added the same id a moment ago
            throw new FeatureConflictException($"A rule with the id '{id}' already exists. Choose another id.");
        }
        logger.LogInformation("Data Anomaly rule {RuleId} added for tenant {TenantId} by {User}.", id, tenantId, user);
        return RuleDto(row, []);
    }

    public async Task<AnomalyRuleDto> UpdateRuleAsync(long tenantId, string ruleId, SaveAnomalyRuleRequest request, string user,
        CancellationToken ct)
    {
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var rule = await db.AnomalyRules.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.RuleId == ruleId, ct)
            ?? throw new KeyNotFoundException($"There is no Data Anomaly rule '{ruleId}'.");
        // Two people editing the same rule: the second save is refused rather than silently replacing the first.
        if (ChangedSince(rule.ModifiedAt, request.ExpectedModifiedAt))
            throw new FeatureConflictException(
                $"{rule.ModifiedBy} changed this rule at {rule.ModifiedAt:yyyy-MM-dd HH:mm} UTC, after you opened it. Close the form and open the rule again to see their change.");
        var before = JsonNode.Parse(rule.DefinitionJson) as JsonObject ?? new JsonObject();
        var definition = RuleDefinition(before, rule.RuleId, request);
        before.Remove("ruleHash");
        if (!JsonNode.DeepEquals(before, definition))
        {
            var updated = NewRule(tenantId, JsonSerializer.Deserialize<JsonElement>(definition.ToJsonString(Json)), user, seedHash: null);
            rule.Title = updated.Title;
            rule.Category = updated.Category;
            rule.Severity = updated.Severity;
            rule.Status = updated.Status;
            rule.DefinitionJson = updated.DefinitionJson;
            // No seed hash: the rule is now the tenant's own, and a newer seed never overwrites it.
            rule.SeedHash = null;
            rule.ModifiedBy = user;
            rule.ModifiedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Data Anomaly rule {RuleId} edited for tenant {TenantId} by {User}.", rule.RuleId, tenantId, user);
        }
        var probes = await db.AnomalyProbes.AsNoTracking().Where(p => p.TenantId == tenantId && p.RuleId == rule.RuleId).ToListAsync(ct);
        return RuleDto(rule, probes);
    }

    public async Task<AnomalyRuleDto> ResetRuleAsync(long tenantId, string ruleId, string user, CancellationToken ct)
    {
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var rule = await db.AnomalyRules.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.RuleId == ruleId, ct)
            ?? throw new KeyNotFoundException($"There is no Data Anomaly rule '{ruleId}'.");
        var seed = SeedRules().FirstOrDefault(r => string.Equals(Str(r, "ruleId"), rule.RuleId, StringComparison.OrdinalIgnoreCase));
        if (seed.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException($"'{rule.RuleId}' was added here, so it has no default text to go back to.");
        var hash = Hash(seed);
        if (rule.SeedHash != hash)
        {
            var original = NewRule(tenantId, seed, user, hash);
            rule.Title = original.Title;
            rule.Category = original.Category;
            rule.Severity = original.Severity;
            rule.Source = original.Source;
            rule.DefinitionJson = WithField(original.DefinitionJson, "status", rule.Status);
            rule.SeedHash = hash;
            rule.ModifiedBy = user;
            rule.ModifiedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Data Anomaly rule {RuleId} reset to its default for tenant {TenantId} by {User}.", rule.RuleId, tenantId, user);
        }
        var probes = await db.AnomalyProbes.AsNoTracking().Where(p => p.TenantId == tenantId && p.RuleId == rule.RuleId).ToListAsync(ct);
        return RuleDto(rule, probes);
    }

    public async Task DeleteRuleAsync(long tenantId, string ruleId, CancellationToken ct)
    {
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var rule = await db.AnomalyRules.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.RuleId == ruleId, ct)
            ?? throw new KeyNotFoundException($"There is no Data Anomaly rule '{ruleId}'.");
        if (IsSeedRule(rule.RuleId))
            throw new InvalidOperationException($"'{rule.RuleId}' is a default rule: set it to disabled instead of deleting it.");
        var probes = await db.AnomalyProbes.Where(p => p.TenantId == tenantId && p.RuleId == rule.RuleId).ToListAsync(ct);
        db.AnomalyProbes.RemoveRange(probes);
        db.AnomalyRules.Remove(rule);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Data Anomaly rule {RuleId} deleted for tenant {TenantId} ({Probes} checks).", rule.RuleId, tenantId, probes.Count);
    }

    // The values the agent runtime accepts (app/features/anomaly/model.py): a rule it would refuse is refused here,
    // when it is saved, not at the next compile.
    internal static readonly string[] Methods = ["rule", "statistical", "rollup"];
    internal static readonly string[] ExpandsOver = ["foreign_key", "duplicate_key", "date_pair", "future_date", "numeric_range", "text_numeric"];
    internal const string CustomCategory = "Custom rules";
    private const int MaxBody = 8000, MaxSql = 20000, MaxTags = 20, MaxParams = 30;

    /// <summary>The rule definition (the runtime's rule dict) of a request: <paramref name="existing"/> is the rule being
    /// edited (null when adding), whose other fields (source, discovery provenance, anything newer) are kept. A field the
    /// request leaves null keeps its current value (or the default when adding); "" clears a text field.</summary>
    internal static JsonObject RuleDefinition(JsonObject? existing, string ruleId, SaveAnomalyRuleRequest request)
    {
        var d = existing?.DeepClone().AsObject() ?? new JsonObject { ["source"] = "declared", ["discovery"] = null };
        string? Old(string name) => d[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

        var title = (request.Title ?? Old("title") ?? "").Trim();
        if (title.Length == 0) throw new InvalidOperationException("Give the rule a title.");
        if (title.Length > 400) throw new InvalidOperationException("A rule's title is at most 400 characters.");
        var body = (request.Body ?? Old("body") ?? "").Trim();
        if (body.Length == 0) throw new InvalidOperationException("Describe the rule: what is wrong and how to detect it.");
        if (body.Length > MaxBody) throw new InvalidOperationException($"A rule's description is at most {MaxBody} characters.");
        // An empty category keeps the rule's own (a new rule goes under "Custom rules").
        var category = (string.IsNullOrWhiteSpace(request.Category) ? Old("category") : request.Category)?.Trim() ?? "";
        if (category.Length > 100) throw new InvalidOperationException("A category is at most 100 characters.");
        var entity = (request.Entity ?? Old("entity") ?? "").Trim();
        if (entity.Length > 60) throw new InvalidOperationException("The entity is at most 60 characters.");

        var severity = OneOf(request.Severity ?? Old("severity"), Severities, "medium", "severity");
        var method = OneOf(request.Method ?? Old("method"), Methods, "rule", "method");
        // An admin chooses active, probation, draft or disabled; a rejected rule stays rejected unless one is chosen.
        var status = request.Status is null && Old("status") == "rejected" ? "rejected"
            : OneOf(request.Status ?? Old("status"), RuleStatuses, "active", "status");
        var expands = (request.ExpandsOver ?? Old("expandsOver") ?? "").Trim().ToLowerInvariant();
        if (expands.Length > 0 && !ExpandsOver.Contains(expands))
            throw new InvalidOperationException($"A rule family repeats over one of: {string.Join(", ", ExpandsOver)} (or leave it empty).");

        var summarySql = (request.SummarySql ?? Old("summarySql") ?? "").Trim();
        var detailSql = (request.DetailSql ?? Old("detailSql") ?? "").Trim();
        if ((summarySql.Length > 0) != (detailSql.Length > 0))
            throw new InvalidOperationException("Give both the summary SQL and the detail SQL, or neither (the AI then writes them).");
        if (summarySql.Length > MaxSql || detailSql.Length > MaxSql)
            throw new InvalidOperationException($"A rule's SQL is at most {MaxSql} characters.");
        if (expands.Length > 0 && summarySql.Length > 0)
            throw new InvalidOperationException("A rule family is written per schema feature, so it cannot carry its own SQL. Clear the SQL or the family.");
        // Own SQL is a starting point the AI adapts ("seed") unless it was pinned; without SQL the AI writes it.
        var sqlMode = summarySql.Length == 0 ? "authored" : Old("sqlMode") == "pinned" ? "pinned" : "seed";

        var tags = request.Tags is null
            ? (d["tags"] as JsonArray)?.Select(t => t?.ToString() ?? "").ToList() ?? []
            : request.Tags.Select(t => (t ?? "").Trim()).Where(t => t.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (tags.Count > MaxTags || tags.Any(t => t.Length > 40)) throw new InvalidOperationException($"Use at most {MaxTags} tags of up to 40 characters.");

        JsonObject parameters;
        if (request.Params is null) parameters = d["params"] as JsonObject is { } p ? p.DeepClone().AsObject() : new JsonObject();
        else
        {
            parameters = new JsonObject();
            foreach (var (key, value) in request.Params)
            {
                var name = (key ?? "").Trim().ToLowerInvariant();
                if (name.Length == 0) continue;
                if (name.Length > 60 || (value ?? "").Length > 500)
                    throw new InvalidOperationException("A value's name is at most 60 characters and its value at most 500.");
                parameters[name] = (value ?? "").Trim();
            }
        }
        if (parameters.Count > MaxParams) throw new InvalidOperationException($"A rule declares at most {MaxParams} values.");

        d["ruleId"] = ruleId;
        d["title"] = title;
        d["category"] = category.Length > 0 ? category : existing is null ? CustomCategory : "Uncategorised";
        d["severity"] = severity;
        d["entity"] = entity.Length > 0 ? entity : "row";
        d["method"] = method;
        d["sqlMode"] = sqlMode;
        d["status"] = status;
        d["tags"] = new JsonArray(tags.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray());
        d["expandsOver"] = expands;
        d["body"] = body;
        d["params"] = parameters;
        d["summarySql"] = summarySql;
        d["detailSql"] = detailSql;
        // The runtime works out the definition's hash itself; a stored copy would only go stale.
        d.Remove("ruleHash");
        return d;
    }

    /// <summary>True when the rule was saved after the time the form was opened with (null: no check). Stored times are
    /// UTC without a kind; the page sends back the value it was given (no offset = UTC).</summary>
    internal static bool ChangedSince(DateTime modifiedAt, DateTime? expected) =>
        expected is { } e && Math.Abs((modifiedAt - (e.Kind == DateTimeKind.Local ? e.ToUniversalTime() : e)).TotalMilliseconds) > 1;

    private static string OneOf(string? value, string[] allowed, string fallback, string what)
    {
        var v = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().ToLowerInvariant();
        if (!allowed.Contains(v)) throw new InvalidOperationException($"A rule's {what} must be one of {string.Join(", ", allowed)}.");
        return v;
    }

    /// <summary>DQ-U01, DQ-U02…: the next id after the highest DQ-U number in use.</summary>
    internal static string NextUserRuleId(IEnumerable<string> taken)
    {
        var max = taken.Select(id => UserRuleIdPattern().Match(id)).Where(m => m.Success)
            .Select(m => int.TryParse(m.Groups[1].Value, out var n) ? n : 0).DefaultIfEmpty(0).Max();
        return $"DQ-U{max + 1:00}";
    }

    private static IReadOnlyList<JsonElement> SeedRules() =>
        AgenticFeatureCatalog.IsKnown(Feature) ? AgenticFeatureCatalog.Get(Feature).Rules : [];

    private static readonly Lazy<HashSet<string>> SeedRuleIds = new(() =>
        SeedRules().Select(r => Str(r, "ruleId")).Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase));

    internal static bool IsSeedRule(string ruleId) => SeedRuleIds.Value.Contains(ruleId);

    // ── Runs and reports ───────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AnomalyCheckDto>> ChecksAsync(long tenantId, string id, CancellationToken ct)
    {
        var key = (id ?? "").Trim();
        if (key.Length is 0 or > 200) return [];
        var probes = await db.AnomalyProbes.AsNoTracking()
            .Where(p => p.TenantId == tenantId && (p.ProbeId == key || p.RuleId == key))
            .OrderBy(p => p.ProbeId).Take(200).ToListAsync(ct);
        return probes.Select(p =>
        {
            var json = Parse(p.ProbeJson) ?? EmptyObject;
            var tables = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("tables", out var t) && t.ValueKind == JsonValueKind.Array
                ? t.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
                : [];
            return new AnomalyCheckDto(p.ProbeId, p.RuleId, p.Status, NullIfEmpty(Str(json, "summarySql")), NullIfEmpty(Str(json, "detailSql")),
                tables, p.Status == "active" ? NullIfEmpty(Str(json, "error")) : ProbeReason(json), Utc(p.CompiledAt));
        }).ToList();
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    /// <summary>Why a check does not run: its error, else the reviewer's or the grounding's note (a check the AI found
    /// not applicable may carry its reason only there, or in the comment that opens its SQL).</summary>
    internal static string? ProbeReason(JsonElement probe) =>
        NullIfEmpty(Str(probe, "error")) ?? NullIfEmpty(Str(probe, "verifierNote")) ?? NullIfEmpty(Str(probe, "groundingNote"))
        ?? NullIfEmpty(string.Join(" ", (Str(probe, "summarySql") ?? "").Split('\n').Select(l => l.Trim())
            .TakeWhile(l => l.StartsWith("--")).Select(l => l.TrimStart('-').Trim())));

    public async Task<IReadOnlyList<AnomalyRunSummaryDto>> RunsAsync(long tenantId, int take, CancellationToken ct)
    {
        var runs = await db.AnomalyRuns.AsNoTracking().Where(r => r.TenantId == tenantId)
            .OrderByDescending(r => r.StartedAt).ThenByDescending(r => r.Id).Take(Math.Clamp(take, 1, 200))
            .Select(r => new AnomalyRun
            {
                Id = r.Id, RunId = r.RunId, Status = r.Status, DatabaseName = r.DatabaseName, StartedAt = r.StartedAt,
                FinishedAt = r.FinishedAt, Score = r.Score, ProbesRun = r.ProbesRun, RecordsExamined = r.RecordsExamined,
                RecordsFlagged = r.RecordsFlagged, StartedBy = r.StartedBy, Error = r.Error,
            })
            .ToListAsync(ct);
        var ids = runs.Select(r => r.RunId).ToList();
        var reports = (await db.AnomalyRunReports.AsNoTracking().Where(x => x.TenantId == tenantId && ids.Contains(x.RunId))
            .Select(x => new { x.RunId, x.Format }).ToListAsync(ct)).ToLookup(x => x.RunId, x => x.Format);
        return runs.Select(r => RunSummary(r, reports[r.RunId].Order().ToList())).ToList();
    }

    public async Task<AnomalyRunDto> RunAsync(long tenantId, string runId, CancellationToken ct)
    {
        var run = await db.AnomalyRuns.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.RunId == runId, ct)
            ?? throw new KeyNotFoundException($"There is no Data Anomaly run '{runId}'.");
        return new AnomalyRunDto(RunSummary(run, await ReportFormatsAsync(tenantId, runId, ct)), Parse(run.ResultJson));
    }

    public async Task<AskDataExportFile> ReportAsync(long tenantId, string runId, string format, CancellationToken ct)
    {
        var fmt = (format ?? "").Trim().ToLowerInvariant();
        if (!ReportFormats.Contains(fmt)) throw new InvalidOperationException("A report is xlsx (Excel) or docx (Word).");
        var report = await db.AnomalyRunReports.AsNoTracking()
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.RunId == runId && r.Format == fmt, ct)
            ?? throw new KeyNotFoundException($"Run '{runId}' has no {fmt} report.");
        return new AskDataExportFile(report.Content, ContentType(fmt), report.FileName);
    }

    // ── Proposals ──────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AnomalyProposalDto>> ProposalsAsync(long tenantId, string? status, CancellationToken ct)
    {
        var query = db.AnomalyProposals.AsNoTracking().Where(p => p.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(status))
        {
            var value = status.Trim().ToLowerInvariant();
            if (!ProposalStatuses.Contains(value)) throw new InvalidOperationException($"A proposal's status is one of {string.Join(", ", ProposalStatuses)}.");
            query = query.Where(p => p.Status == value);
        }
        return (await query.OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id).Take(500).ToListAsync(ct))
            .Select(ProposalDto).ToList();
    }

    /// <summary>The agent runtime turns the proposal into a rule (the original's discovery.accept), stored as a
    /// discovered rule, on probation unless the admin chose another status.</summary>
    public async Task<AnomalyProposalDto> AcceptProposalAsync(long tenantId, long id, DecideAnomalyProposalRequest request, string user,
        CancellationToken ct)
    {
        var proposal = await PendingProposalAsync(tenantId, id, ct);
        var status = string.IsNullOrWhiteSpace(request.Status) ? "probation" : request.Status.Trim().ToLowerInvariant();
        if (status is not ("probation" or "active"))
            throw new InvalidOperationException("An accepted proposal becomes a rule on probation (reported apart until you trust it) or active.");
        var wanted = string.IsNullOrWhiteSpace(request.RuleId) ? null : request.RuleId.Trim();
        if (wanted is not null && !RuleIdPattern().IsMatch(wanted))
            throw new InvalidOperationException("A rule id is 1 to 60 letters, digits, '-', '_' or '.', starting with a letter or digit.");
        await EnsureRulesAsync(db, tenantId, logger, ct);
        var taken = await db.AnomalyRules.Where(r => r.TenantId == tenantId).Select(r => r.RuleId).ToListAsync(ct);
        if (wanted is not null && taken.Contains(wanted, StringComparer.OrdinalIgnoreCase))
            throw new FeatureConflictException($"A rule with the id '{wanted}' already exists. Choose another id.");

        var reply = await gateway.CallAsync(tenantId, user, Feature, "proposal-to-rule",
            new { proposal = Parse(proposal.ProposalJson), ruleId = wanted, status, reason = request.Reason ?? "",
                rules = taken.Select(id => new { ruleId = id }) }, needsAi: false, ct);
        if (!reply.TryGetProperty("rule", out var rule) || rule.ValueKind != JsonValueKind.Object)
            throw new AgentRuntimeException(503, "Data Anomaly did not return the rule for this proposal. Try again.");
        var row = NewRule(tenantId, rule, user, seedHash: null);
        if (taken.Contains(row.RuleId, StringComparer.OrdinalIgnoreCase))
            throw new FeatureConflictException($"A rule with the id '{row.RuleId}' already exists. Choose another id.");

        db.AnomalyRules.Add(row);
        proposal.Status = "accepted";
        proposal.RuleId = row.RuleId;
        proposal.Reason = Clip(request.Reason, 1000);
        proposal.DecidedBy = user;
        proposal.DecidedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return ProposalDto(proposal);
    }

    /// <summary>A rejected proposal is passed to every later Discover, which does not propose it again.</summary>
    public async Task<AnomalyProposalDto> RejectProposalAsync(long tenantId, long id, DecideAnomalyProposalRequest request, string user,
        CancellationToken ct)
    {
        var proposal = await PendingProposalAsync(tenantId, id, ct);
        proposal.Status = "rejected";
        proposal.Reason = Clip(request.Reason, 1000);
        proposal.DecidedBy = user;
        proposal.DecidedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return ProposalDto(proposal);
    }

    private async Task<AnomalyProposal> PendingProposalAsync(long tenantId, long id, CancellationToken ct)
    {
        var proposal = await db.AnomalyProposals.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id, ct)
            ?? throw new KeyNotFoundException("There is no such proposal.");
        if (proposal.Status != "pending") throw new FeatureConflictException($"This proposal was already {proposal.Status}.");
        return proposal;
    }

    // ── Jobs ────────────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<AiFeatureJobDto> StartJobAsync(long tenantId, StartAnomalyJobRequest request, string user, CancellationToken ct)
    {
        var kind = (request.Kind ?? "").Trim().ToLowerInvariant();
        if (!Kinds.Contains(kind)) throw new InvalidOperationException($"A Data Anomaly job is one of {string.Join(", ", Kinds)}.");
        var ruleIds = (request.RuleIds ?? []).Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).Distinct().ToList();
        if (ruleIds.Count > MaxRuleIds || ruleIds.Any(r => r.Length > 200)) throw new InvalidOperationException("Too many or too long rule ids.");
        var formats = (request.Formats ?? ReportFormats).Select(f => (f ?? "").Trim().ToLowerInvariant()).Distinct().ToList();
        if (formats.Any(f => !ReportFormats.Contains(f))) throw new InvalidOperationException("A report is xlsx (Excel) or docx (Word).");
        if (request.MaxProposals is < 1 or > MaxProposals) throw new InvalidOperationException($"Ask for 1 to {MaxProposals} proposals.");

        var seed = AgenticFeatureCatalog.Get(Feature);
        var s = await settings.GetAsync(tenantId, ct);
        if (!AgenticFeatureSettingsRules.IsConfigured(seed, AgenticFeatureSettingsRules.Resolve(seed, AgenticFeatureSettingsRules.Stored(s, Feature)).Access))
            throw new InvalidOperationException($"{seed.Title} is not set up yet: an admin chooses the schemas it may read under AI Settings → Ask Data & Features → {seed.Title}.");
        // Compile and Discover cannot work without the AI: say so now, not after the job is queued.
        if (kind != KindRun) await ai.ResolveProviderAsync(tenantId, ct);
        if (ruleIds.Count > 0)
        {
            await EnsureRulesAsync(db, tenantId, logger, ct);
            var known = await db.AnomalyRules.Where(r => r.TenantId == tenantId).Select(r => r.RuleId).ToListAsync(ct);
            var unknown = ruleIds.Where(r => !known.Contains(r, StringComparer.OrdinalIgnoreCase)).Take(5).ToList();
            if (unknown.Count > 0) throw new InvalidOperationException($"Unknown rule(s): {string.Join(", ", unknown)}.");
        }

        var options = new JsonObject
        {
            ["ruleIds"] = JsonSerializer.SerializeToNode(ruleIds, Json),
            ["force"] = request.Force,
            ["retryFailed"] = request.RetryFailed,
        };
        if (kind == KindRun)
        {
            options["formats"] = JsonSerializer.SerializeToNode(formats, Json);
            options["runId"] = NewRunId();
        }
        if (kind == KindDiscover && request.MaxProposals is { } max) options["maxProposals"] = max;

        // With a job worker running on this instance the job is created already claimed (running, with a heartbeat) and
        // started here: other Tenant APIs on the same database only take QUEUED jobs, so a developer's job never runs on a
        // colleague's PC. Without a local worker it is queued for whichever instance takes it.
        var now = DateTime.UtcNow;
        var here = signal.RunsJobsHere;
        var job = new AiFeatureJob
        {
            TenantId = tenantId, Feature = Feature, Kind = kind,
            Status = here ? AiFeatureJobStatus.Running : AiFeatureJobStatus.Queued,
            StartedAt = here ? now : null, HeartbeatAt = here ? now : null,
            RequestJson = options.ToJsonString(Json), RequestedBy = user, CreatedAt = now,
        };
        db.AiFeatureJobs.Add(job);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // UX_core_AiFeatureJob_active: one queued or running job per tenant and feature.
            db.ChangeTracker.Clear();
            var active = await db.AiFeatureJobs.AsNoTracking()
                .Where(j => j.TenantId == tenantId && j.Feature == Feature
                    && (j.Status == AiFeatureJobStatus.Queued || j.Status == AiFeatureJobStatus.Running))
                .FirstOrDefaultAsync(ct);
            if (active is null) throw;
            throw new FeatureConflictException($"A Data Anomaly {active.Kind} is already {active.Status}. Wait for it to finish or cancel it.");
        }
        if (here) signal.Claimed(job.Id);
        else signal.Notify();
        logger.LogInformation("Data Anomaly {Kind} job {JobId} {How} for tenant {TenantId} by {User}.", kind, job.Id,
            here ? "started on this server" : "queued", tenantId, user);
        return JobDto(job);
    }

    public async Task<IReadOnlyList<AiFeatureJobDto>> JobsAsync(long tenantId, int take, CancellationToken ct) =>
        (await db.AiFeatureJobs.AsNoTracking().Where(j => j.TenantId == tenantId && j.Feature == Feature)
            .OrderByDescending(j => j.Id).Take(Math.Clamp(take, 1, 100)).ToListAsync(ct))
        .Select(JobDto).ToList();

    public async Task<AiFeatureJobDto> JobAsync(long tenantId, long id, CancellationToken ct) =>
        JobDto(await db.AiFeatureJobs.AsNoTracking().FirstOrDefaultAsync(j => j.TenantId == tenantId && j.Feature == Feature && j.Id == id, ct)
            ?? throw new KeyNotFoundException("There is no such job."));

    /// <summary>A queued job never starts; a running one is stopped by the worker at its next heartbeat (seconds).</summary>
    public async Task<AiFeatureJobDto> CancelJobAsync(long tenantId, long id, string user, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var message = Clip($"Cancelled by {user}.", 4000);
        var changed = await db.AiFeatureJobs
            .Where(j => j.TenantId == tenantId && j.Feature == Feature && j.Id == id
                && (j.Status == AiFeatureJobStatus.Queued || j.Status == AiFeatureJobStatus.Running))
            .ExecuteUpdateAsync(x => x.SetProperty(j => j.Status, AiFeatureJobStatus.Cancelled)
                .SetProperty(j => j.FinishedAt, now).SetProperty(j => j.Error, message), ct);
        var job = await JobAsync(tenantId, id, ct);
        if (changed == 0 && job.Status != AiFeatureJobStatus.Cancelled) throw new FeatureConflictException($"This job has already {job.Status}.");
        return job;
    }

    // ── Shared with the job runner ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>Copies the seed's rules into the tenant's database (missing ones added, unedited ones upgraded with the
    /// status kept), once per tenant and process.</summary>
    internal static async Task EnsureRulesAsync(TenantDbContext db, long tenantId, ILogger logger, CancellationToken ct)
    {
        if (Seeded.ContainsKey(tenantId)) return;
        var seed = AgenticFeatureCatalog.IsKnown(Feature) ? AgenticFeatureCatalog.Get(Feature).Rules : [];
        for (var attempt = 1; ; attempt++)
        {
            var existing = await db.AnomalyRules.Where(r => r.TenantId == tenantId)
                .ToDictionaryAsync(r => r.RuleId, StringComparer.OrdinalIgnoreCase, ct);
            var changed = 0;
            foreach (var rule in seed)
            {
                var id = Str(rule, "ruleId");
                if (string.IsNullOrWhiteSpace(id)) continue;
                var hash = Hash(rule);
                if (!existing.TryGetValue(id, out var row))
                {
                    var added = NewRule(tenantId, rule, SystemUser, hash);
                    db.AnomalyRules.Add(added);
                    existing[id] = added;
                    changed++;
                }
                else if (row.SeedHash is not null && row.SeedHash != hash)
                {
                    var upgraded = NewRule(tenantId, rule, SystemUser, hash);
                    row.Title = upgraded.Title;
                    row.Category = upgraded.Category;
                    row.Severity = upgraded.Severity;
                    row.Source = upgraded.Source;
                    row.DefinitionJson = WithField(upgraded.DefinitionJson, "status", row.Status);
                    row.SeedHash = hash;
                    row.ModifiedBy = SystemUser;
                    row.ModifiedAt = DateTime.UtcNow;
                    changed++;
                }
            }
            try
            {
                if (changed > 0)
                {
                    await db.SaveChangesAsync(ct);
                    logger.LogInformation("Data Anomaly: {Count} seed rules added or upgraded for tenant {TenantId}.", changed, tenantId);
                }
                Seeded[tenantId] = true;
                return;
            }
            catch (DbUpdateException) when (attempt < 3)
            {
                db.ChangeTracker.Clear();   // another request seeded the same rules first
            }
        }
    }

    /// <summary>A rule row from its definition (the agent runtime's rule dict, camelCase). Severity and status outside
    /// the database's allowed values fall back to medium / draft, and the definition says so too.</summary>
    internal static AnomalyRule NewRule(long tenantId, JsonElement rule, string user, string? seedHash)
    {
        var id = Str(rule, "ruleId")?.Trim() ?? "";
        if (id.Length is 0 or > 80) throw new InvalidOperationException("A Data Anomaly rule needs an id of at most 80 characters.");
        var severity = (Str(rule, "severity") ?? "medium").Trim().ToLowerInvariant();
        if (!Severities.Contains(severity)) severity = "medium";
        var status = (Str(rule, "status") ?? "active").Trim().ToLowerInvariant();
        if (!RuleStatuses.Contains(status) && status != "rejected") status = "draft";
        var source = (Str(rule, "source") ?? "declared").Trim().ToLowerInvariant() == "discovered" ? "discovered" : "declared";
        var definition = WithField(WithField(rule.GetRawText(), "severity", severity), "status", status);
        var now = DateTime.UtcNow;
        return new AnomalyRule
        {
            TenantId = tenantId, RuleId = id, Title = Clip(Str(rule, "title")?.Trim(), 400) is { Length: > 0 } t ? t : id,
            Category = Clip(Str(rule, "category")?.Trim(), 100), Severity = severity, Status = status, Source = source,
            DefinitionJson = definition, SeedHash = seedHash, CreatedBy = user, CreatedAt = now, ModifiedBy = user, ModifiedAt = now,
        };
    }

    internal static string Hash(JsonElement e) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(e)))).ToLowerInvariant();

    internal static string WithField(string json, string name, string value)
    {
        var node = JsonNode.Parse(json) as JsonObject ?? new JsonObject();
        node[name] = value;
        return node.ToJsonString(Json);
    }

    internal static string ContentType(string format) => format == "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    internal static AiFeatureJobDto JobDto(AiFeatureJob j) => new(j.Id, j.Feature, j.Kind, j.Status, Parse(j.RequestJson),
        Parse(j.ProgressJson), Parse(j.ResultJson), j.Error, j.RequestedBy, j.CreatedAt, j.StartedAt, j.FinishedAt);

    internal static JsonElement? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(json); }
        catch (JsonException) { return null; }
    }

    internal static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Stored times are UTC without a kind: marked UTC so the page reads them as UTC (sent with "Z").</summary>
    internal static DateTime Utc(DateTime t) => t.Kind == DateTimeKind.Utc ? t : DateTime.SpecifyKind(t, DateTimeKind.Utc);

    internal static string? Clip(string? text, int max) => text is null ? null : text.Length <= max ? text : text[..max];

    /// <summary>run-yyyyMMdd-HHmmss-xxxx (UTC): sortable, unique, at most 40 characters.</summary>
    internal static string NewRunId() =>
        $"run-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(2)).ToLowerInvariant()}";

    private async Task<IReadOnlyList<string>> ReportFormatsAsync(long tenantId, string runId, CancellationToken ct) =>
        await db.AnomalyRunReports.AsNoTracking().Where(r => r.TenantId == tenantId && r.RunId == runId)
            .Select(r => r.Format).OrderBy(f => f).ToListAsync(ct);

    private static AnomalyRunSummaryDto RunSummary(AnomalyRun r, IReadOnlyList<string> reports) => new(r.RunId, r.Status, r.DatabaseName,
        r.StartedAt, r.FinishedAt, r.Score, r.ProbesRun, r.RecordsExamined, r.RecordsFlagged, r.StartedBy, r.Error, reports);

    private static AnomalyProposalDto ProposalDto(AnomalyProposal p) => new(p.Id, p.ProposalHash, p.Status, p.Title,
        Parse(p.ProposalJson) ?? EmptyObject, p.RuleId, p.Reason, p.DecidedBy, p.DecidedAt, p.CreatedAt);

    private static AnomalyRuleDto RuleDto(AnomalyRule r, IReadOnlyList<AnomalyProbe> probes)
    {
        string? probeStatus = null, error = null;
        var failed = probes.Count(p => p.Status == "failed");
        if (probes.Count > 0)
        {
            probeStatus = failed > 0 ? "failed"
                : probes.Any(p => p.Status == "active") ? "active"
                : probes[0].Status;
            // Why it does not run: a failed check's error first, else why a check could not be applied here.
            error = probes.Where(p => p.Status == "failed").Concat(probes.Where(p => p.Status == "not_applicable"))
                .Select(p => ProbeReason(Parse(p.ProbeJson) ?? EmptyObject)).FirstOrDefault(e => e is not null);
        }
        return new AnomalyRuleDto(r.RuleId, r.Title, r.Category, r.Severity, r.Status, r.Source, Parse(r.DefinitionJson) ?? EmptyObject,
            probeStatus, probes.Count, failed, error, probes.Count == 0 ? null : Utc(probes.Max(p => p.CompiledAt)), r.SeedHash is null,
            r.ModifiedBy, Utc(r.ModifiedAt), IsSeedRule(r.RuleId));
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$")]
    private static partial Regex RuleIdPattern();

    [GeneratedRegex("^DQ-U(\\d{1,6})$", RegexOptions.IgnoreCase)]
    private static partial Regex UserRuleIdPattern();
}
