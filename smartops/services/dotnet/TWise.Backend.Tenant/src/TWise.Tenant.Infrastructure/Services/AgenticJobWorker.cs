using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>In-process wake-up for the job worker: a job queued on this instance starts at once instead of at the
/// next poll.</summary>
public sealed class AgenticJobSignal : IAgenticJobSignal
{
    private readonly SemaphoreSlim _signal = new(0, 1);

    public void Notify()
    {
        try { _signal.Release(); }
        catch (SemaphoreFullException) { }   // already signalled
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);
}

/// <summary>
/// Runs the Agentic Features' long jobs (core.AiFeatureJob, today Data Anomaly's compile / run / discover). Every
/// AgenticFeatures:JobPollSeconds (5), or at once when a job is queued here, it claims queued jobs (UPDLOCK + READPAST,
/// so several API instances never take the same one) up to AgenticFeatures:MaxParallelJobs (2) at a time. A running
/// job writes a heartbeat while the agent runtime streams progress; one silent for AgenticFeatures:StaleJobMinutes (5)
/// is marked failed (its instance stopped). On shutdown a running job goes back to the queue. AgenticFeatures:JobsEnabled
/// false turns the worker off on this instance.
/// </summary>
public sealed class AgenticJobWorker(IServiceScopeFactory scopes, IAgenticJobSignal signal, IConfiguration config,
    ILogger<AgenticJobWorker> logger) : BackgroundService
{
    private readonly ConcurrentDictionary<long, Task> _running = new();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (bool.TryParse(config["AgenticFeatures:JobsEnabled"], out var enabled) && !enabled) return;
        var poll = TimeSpan.FromSeconds(Setting("AgenticFeatures:JobPollSeconds", 5, 1, 300));
        var maxParallel = Setting("AgenticFeatures:MaxParallelJobs", 2, 1, 16);
        var stale = TimeSpan.FromMinutes(Setting("AgenticFeatures:StaleJobMinutes", 5, 2, 120));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await FailStaleAsync(stale, stoppingToken);
                while (_running.Count < maxParallel && await ClaimAsync(stoppingToken) is { } id)
                    _running[id] = Task.Run(() => RunAsync(id, stoppingToken), CancellationToken.None);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Agentic Features: could not read the job queue");
            }
            try { await signal.WaitAsync(poll, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
        await Task.WhenAll(_running.Values);   // each running job puts itself back in the queue
    }

    private async Task RunAsync(long jobId, CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AgenticJobRunner>().RunAsync(jobId, stoppingToken);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Agentic Features: job {JobId} crashed", jobId);
        }
        finally
        {
            _running.TryRemove(jobId, out _);
            signal.Notify();   // a slot is free: look at the queue again
        }
    }

    private async Task<long?> ClaimAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TenantDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var now = DateTime.UtcNow;
        var ids = await db.Database.SqlQuery<long>($"""
            WITH next AS (
                SELECT TOP (1) id, status, started_at, heartbeat_at, progress_json
                FROM core.AiFeatureJob WITH (UPDLOCK, READPAST, ROWLOCK)
                WHERE status = 'queued'
                ORDER BY id)
            UPDATE next SET status = 'running', started_at = {now}, heartbeat_at = {now}, progress_json = NULL
            OUTPUT inserted.id AS Value;
            """).ToListAsync(ct);
        await transaction.CommitAsync(ct);
        return ids.Count > 0 ? ids[0] : null;
    }

    private async Task FailStaleAsync(TimeSpan stale, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TenantDbContext>();
        var now = DateTime.UtcNow;
        var cutoff = now - stale;
        var count = await db.AiFeatureJobs
            .Where(j => j.Status == AiFeatureJobStatus.Running && (j.HeartbeatAt == null || j.HeartbeatAt < cutoff))
            .ExecuteUpdateAsync(x => x.SetProperty(j => j.Status, AiFeatureJobStatus.Failed).SetProperty(j => j.FinishedAt, now)
                .SetProperty(j => j.Error, "The job stopped responding (the service may have restarted). Start it again."), ct);
        if (count > 0) logger.LogWarning("Agentic Features: {Count} job(s) stopped responding and were marked failed", count);
    }

    private int Setting(string key, int fallback, int min, int max) =>
        int.TryParse(config[key], out var v) ? Math.Clamp(v, min, max) : fallback;
}

/// <summary>
/// Runs one claimed job: builds the request from the tenant's database (rules, compiled checks, decided proposals,
/// options), streams it through the agent runtime, keeps the job's progress and heartbeat current, stores the outcome
/// (catalog, run and reports, proposals) and the AI usage, and closes the job. A job cancelled or failed by someone else
/// meanwhile stops at its next heartbeat; a shutdown puts it back in the queue.
/// </summary>
public sealed partial class AgenticJobRunner(TenantDbContext db, IAgenticFeatureContext context, IAgentRuntimeClient runtime,
    IAiUsageRepository usage, ILogger<AgenticJobRunner> logger)
{
    private static readonly TimeSpan BeatEvery = TimeSpan.FromSeconds(10);
    private const int MaxCoveredChecks = 1000;
    private static readonly string[] ProbeStatuses = ["active", "failed", "not_applicable", "disabled"];

    public async Task RunAsync(long jobId, CancellationToken stoppingToken)
    {
        var job = await db.AiFeatureJobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == jobId, stoppingToken);
        if (job is null || job.Status != AiFeatureJobStatus.Running) return;
        if (job.Feature != DataAnomalyService.Feature || !DataAnomalyService.Kinds.Contains(job.Kind))
        {
            await FinishAsync(job.Id, AiFeatureJobStatus.Failed, null, $"Unknown job {job.Feature}/{job.Kind}.");
            return;
        }

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var abandoned = false;
        var lastBeat = DateTime.UtcNow;
        string? lastProgress = null;
        var started = DateTime.UtcNow;
        var options = DataAnomalyService.Parse(job.RequestJson) ?? JsonSerializer.Deserialize<JsonElement>("{}");

        async Task BeatAsync(string? progress)
        {
            var now = DateTime.UtcNow;
            if (progress == lastProgress && now - lastBeat < BeatEvery) return;
            if (progress != lastProgress && now - lastBeat < TimeSpan.FromSeconds(2)) return;   // progress at most every 2 s
            lastBeat = now;
            lastProgress = progress ?? lastProgress;
            var stored = lastProgress;
            var alive = await db.AiFeatureJobs.Where(j => j.Id == jobId && j.Status == AiFeatureJobStatus.Running)
                .ExecuteUpdateAsync(x => x.SetProperty(j => j.HeartbeatAt, now).SetProperty(j => j.ProgressJson, stored), CancellationToken.None);
            if (alive == 0)
            {
                abandoned = true;   // cancelled by a user, or marked failed as stale: stop the runtime too
                await cts.CancelAsync();
            }
        }

        try
        {
            await DataAnomalyService.EnsureRulesAsync(db, job.TenantId, logger, cts.Token);
            var body = await BodyAsync(job, options, cts.Token);
            var envelope = await EnvelopeAsync(job, cts.Token);
            JsonElement? result = null;
            string? error = null;
            await foreach (var ev in runtime.FeatureStreamAsync(job.Feature, job.Kind, envelope, body, cts.Token))
            {
                switch (ev.Type)
                {
                    case "progress":
                        await BeatAsync(ev.Data.GetRawText());
                        break;
                    case "result":
                        result = ev.Data;
                        break;
                    case "error":
                        error = DataAnomalyService.Str(ev.Data, "message") ?? "Data Anomaly reported an error.";
                        break;
                    default:   // ping
                        await BeatAsync(null);
                        break;
                }
            }

            if (result is { } r)
            {
                var summary = await StoreAsync(job, options, r, started);
                await AgenticFeatureGateway.LogUsageAsync(usage, job.TenantId, job.RequestedBy, job.Feature, r);
                await FinishAsync(job.Id, AiFeatureJobStatus.Succeeded, summary, null);
                logger.LogInformation("Data Anomaly {Kind} job {JobId} finished for tenant {TenantId}.", job.Kind, job.Id, job.TenantId);
            }
            else
            {
                error ??= "The agent service ended the job without a result.";
                if (job.Kind == DataAnomalyService.KindRun) await StoreFailedRunAsync(job, options, started, error);
                await FinishAsync(job.Id, AiFeatureJobStatus.Failed, null, error);
            }
        }
        catch (OperationCanceledException) when (abandoned)
        {
            logger.LogInformation("Data Anomaly job {JobId} stopped: it was cancelled or marked failed.", job.Id);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down: back to the queue, to start again on this or another instance.
            await db.AiFeatureJobs.Where(j => j.Id == jobId && j.Status == AiFeatureJobStatus.Running)
                .ExecuteUpdateAsync(x => x.SetProperty(j => j.Status, AiFeatureJobStatus.Queued).SetProperty(j => j.StartedAt, (DateTime?)null)
                    .SetProperty(j => j.HeartbeatAt, (DateTime?)null).SetProperty(j => j.ProgressJson, (string?)null), CancellationToken.None);
        }
        catch (Exception ex) when (ex is AgentRuntimeException or InvalidOperationException or KeyNotFoundException)
        {
            await FailAsync(job, options, started, ex.Message);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Data Anomaly job {JobId}: the agent runtime is not reachable", job.Id);
            await FailAsync(job, options, started, "The agent service is not reachable. Try again in a moment.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Data Anomaly job {JobId} failed", job.Id);
            await FailAsync(job, options, started, "The job failed unexpectedly. The server log has the details.");
        }
    }

    private async Task FailAsync(AiFeatureJob job, JsonElement options, DateTime started, string message)
    {
        if (job.Kind == DataAnomalyService.KindRun)
        {
            try { await StoreFailedRunAsync(job, options, started, message); }
            catch (Exception ex) { logger.LogWarning(ex, "Data Anomaly job {JobId}: the failed run could not be recorded", job.Id); }
        }
        await FinishAsync(job.Id, AiFeatureJobStatus.Failed, null, message);
    }

    /// <summary>Closes the job unless someone already did (cancelled, or failed as stale).</summary>
    private async Task FinishAsync(long jobId, string status, JsonObject? result, string? error)
    {
        var now = DateTime.UtcNow;
        var resultJson = result?.ToJsonString(DataAnomalyService.Json);
        var message = DataAnomalyService.Clip(error, 4000);
        await db.AiFeatureJobs.Where(j => j.Id == jobId && j.Status == AiFeatureJobStatus.Running)
            .ExecuteUpdateAsync(x => x.SetProperty(j => j.Status, status).SetProperty(j => j.FinishedAt, now)
                .SetProperty(j => j.HeartbeatAt, now).SetProperty(j => j.ResultJson, resultJson).SetProperty(j => j.Error, message),
                CancellationToken.None);
    }

    /// <summary>Compile and Discover need the AI; a run uses it only to recompile stale checks (when the settings allow),
    /// so without it the run still goes ahead on the checks already compiled.</summary>
    private async Task<AgenticFeatureEnvelope> EnvelopeAsync(AiFeatureJob job, CancellationToken ct)
    {
        if (job.Kind != DataAnomalyService.KindRun) return await context.BuildAsync(job.TenantId, job.Feature, needsAi: true, ct);
        try { return await context.BuildAsync(job.TenantId, job.Feature, needsAi: true, ct); }
        catch (InvalidOperationException ex)
        {
            logger.LogInformation("Data Anomaly run {JobId} goes ahead without AI: {Reason}", job.Id, ex.Message);
            return await context.BuildAsync(job.TenantId, job.Feature, needsAi: false, ct);
        }
    }

    private async Task<JsonObject> BodyAsync(AiFeatureJob job, JsonElement options, CancellationToken ct)
    {
        var rules = await db.AnomalyRules.AsNoTracking().Where(r => r.TenantId == job.TenantId).OrderBy(r => r.RuleId)
            .Select(r => r.DefinitionJson).ToListAsync(ct);
        var catalog = await db.AnomalyProbes.AsNoTracking().Where(p => p.TenantId == job.TenantId).OrderBy(p => p.ProbeId)
            .Select(p => p.ProbeJson).ToListAsync(ct);
        var body = new JsonObject
        {
            ["rules"] = new JsonArray(rules.Select(r => JsonNode.Parse(r)).ToArray()),
            ["catalog"] = new JsonArray(catalog.Select(p => JsonNode.Parse(p)).ToArray()),
            // No rule ids chosen: every rule (null), not none.
            ["ruleIds"] = Node(options, "ruleIds") is JsonArray { Count: > 0 } ids ? ids : null,
            ["coveredChecks"] = await CoveredChecksAsync(ct),
        };
        switch (job.Kind)
        {
            case DataAnomalyService.KindCompile:
                body["force"] = Bool(options, "force");
                body["retryFailed"] = Bool(options, "retryFailed");
                break;
            case DataAnomalyService.KindRun:
                body["runId"] = DataAnomalyService.Str(options, "runId");
                body["formats"] = Node(options, "formats") ?? new JsonArray("xlsx", "docx");
                break;
            case DataAnomalyService.KindDiscover:
                var decided = await db.AnomalyProposals.AsNoTracking()
                    .Where(p => p.TenantId == job.TenantId && (p.Status == "accepted" || p.Status == "rejected"))
                    .Select(p => new { p.Status, p.ProposalJson, p.Reason, p.RuleId }).ToListAsync(ct);
                JsonArray Decided(string status) => new(decided.Where(d => d.Status == status).Select(d =>
                {
                    var node = JsonNode.Parse(d.ProposalJson) as JsonObject ?? new JsonObject();
                    if (d.Reason is not null) node["reason"] = d.Reason;
                    if (d.RuleId is not null) node["ruleId"] = d.RuleId;
                    return (JsonNode)node;
                }).ToArray());
                body["proposals"] = new JsonObject { ["accepted"] = Decided("accepted"), ["rejected"] = Decided("rejected") };
                if (options.TryGetProperty("maxProposals", out var max) && max.TryGetInt32(out var m)) body["maxProposals"] = m;
                break;
        }
        return body;
    }

    /// <summary>The Data Quality module's own checks (core.DataRules), so Discover does not propose them again and the
    /// compiler knows they exist.</summary>
    private async Task<JsonArray> CoveredChecksAsync(CancellationToken ct)
    {
        var checks = await db.DataRules.AsNoTracking().OrderBy(r => r.RuleId).Take(MaxCoveredChecks)
            .Select(r => new { r.RuleId, r.RuleName, r.TableName, r.Category, r.Fields }).ToListAsync(ct);
        return new JsonArray(checks.Where(c => !string.IsNullOrWhiteSpace(c.RuleName) || !string.IsNullOrWhiteSpace(c.RuleId))
            .Select(c => (JsonNode)new JsonObject
            {
                ["name"] = string.IsNullOrWhiteSpace(c.RuleName) ? c.RuleId : c.RuleName,
                ["table"] = c.TableName ?? "",
                ["description"] = string.Join(" · ", new[] { c.Category, c.Fields }.Where(x => !string.IsNullOrWhiteSpace(x))),
            }).ToArray());
    }

    // ── Outcomes ───────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Stores what the job produced and returns the short outcome kept on the job.</summary>
    private async Task<JsonObject> StoreAsync(AiFeatureJob job, JsonElement options, JsonElement result, DateTime started)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(CancellationToken.None);
        JsonObject summary;
        switch (job.Kind)
        {
            case DataAnomalyService.KindCompile:
                if (result.TryGetProperty("catalog", out var catalog) && catalog.ValueKind == JsonValueKind.Array)
                    await ReplaceCatalogAsync(job.TenantId, catalog);
                summary = Pick(result, "compiled", "reused", "failed", "notApplicable", "removed", "llmCalls", "seconds", "stoppedEarly", "errors");
                break;
            case DataAnomalyService.KindRun:
                if (result.TryGetProperty("catalog", out var recompiled) && recompiled.ValueKind == JsonValueKind.Array)
                    await ReplaceCatalogAsync(job.TenantId, recompiled);   // stale checks recompiled inside the run
                summary = await StoreRunAsync(job, options, result, started);
                break;
            default:
                summary = await StoreProposalsAsync(job.TenantId, result);
                break;
        }
        await transaction.CommitAsync(CancellationToken.None);
        return summary;
    }

    /// <summary>The catalog after a compile is complete: it replaces the stored one.</summary>
    private async Task ReplaceCatalogAsync(long tenantId, JsonElement catalog)
    {
        var ruleIds = (await db.AnomalyRules.AsNoTracking().Where(r => r.TenantId == tenantId).Select(r => r.RuleId).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        await db.AnomalyProbes.Where(p => p.TenantId == tenantId).ExecuteDeleteAsync();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var probe in catalog.EnumerateArray().Where(p => p.ValueKind == JsonValueKind.Object))
        {
            var id = DataAnomalyService.Str(probe, "ruleId")?.Trim();
            if (string.IsNullOrEmpty(id) || id.Length > 200 || !seen.Add(id)) continue;
            var status = DataAnomalyService.Str(probe, "status") ?? "failed";
            db.AnomalyProbes.Add(new AnomalyProbe
            {
                TenantId = tenantId, ProbeId = id, RuleId = OwnerRule(id, ruleIds),
                Status = ProbeStatuses.Contains(status) ? status : "failed", ProbeJson = probe.GetRawText(),
                CompiledAt = DateTime.TryParse(DataAnomalyService.Str(probe, "compiledAt"), CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at) ? at : DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync();
    }

    /// <summary>A family member's probe ("R12-003") belongs to its family rule ("R12").</summary>
    internal static string OwnerRule(string probeId, IReadOnlySet<string> ruleIds)
    {
        if (ruleIds.Contains(probeId)) return probeId;
        var m = FamilyMember().Match(probeId);
        if (m.Success && ruleIds.Contains(m.Groups[1].Value)) return m.Groups[1].Value;
        return probeId.Length <= 80 ? probeId : probeId[..80];
    }

    private async Task<JsonObject> StoreRunAsync(AiFeatureJob job, JsonElement options, JsonElement result, DateTime started)
    {
        var runId = DataAnomalyService.Str(options, "runId") ?? DataAnomalyService.NewRunId();
        var error = DataAnomalyService.Str(result, "error");
        var stored = JsonNode.Parse(result.GetRawText()) as JsonObject ?? new JsonObject();
        stored.Remove("reports");
        stored.Remove("usage");
        stored.Remove("catalog");
        var run = new AnomalyRun
        {
            TenantId = job.TenantId, RunId = runId, Status = string.IsNullOrWhiteSpace(error) ? "succeeded" : "failed",
            DatabaseName = DataAnomalyService.Clip(Text(result, "database"), 200), StartedAt = started, FinishedAt = DateTime.UtcNow,
            Score = Decimal(result, "score"), ProbesRun = (int?)Long(result, "probesRun", "totals.probes_run", "totals.probesRun", "totals.probes"),
            RecordsExamined = Long(result, "recordsExamined", "totals.records_examined", "totals.recordsExamined", "totals.rows_examined"),
            RecordsFlagged = Long(result, "recordsFlagged", "totals.records_flagged", "totals.recordsFlagged", "totals.anomalies"),
            RuleSetFingerprint = DataAnomalyService.Clip(DataAnomalyService.Str(result, "rule_set_fingerprint")
                ?? DataAnomalyService.Str(result, "ruleSetFingerprint"), 40),
            ResultJson = stored.ToJsonString(DataAnomalyService.Json), Error = DataAnomalyService.Clip(error, 4000),
            StartedBy = job.RequestedBy,
        };
        db.AnomalyRuns.Add(run);

        var formats = new List<string>();
        if (result.TryGetProperty("reports", out var reports) && reports.ValueKind == JsonValueKind.Object)
        {
            foreach (var fmt in DataAnomalyService.ReportFormats)
            {
                if (!reports.TryGetProperty(fmt, out var b64) || b64.ValueKind != JsonValueKind.String) continue;
                byte[] content;
                try { content = Convert.FromBase64String(b64.GetString()!); }
                catch (FormatException) { logger.LogWarning("Data Anomaly run {RunId}: the {Format} report is not valid base64", runId, fmt); continue; }
                db.AnomalyRunReports.Add(new AnomalyRunReport
                {
                    TenantId = job.TenantId, RunId = runId, Format = fmt, FileName = $"data-anomaly-{runId}.{fmt}",
                    Content = content, SizeBytes = content.LongLength, CreatedAt = DateTime.UtcNow,
                });
                formats.Add(fmt);
            }
        }
        await db.SaveChangesAsync();
        return new JsonObject
        {
            ["runId"] = runId, ["status"] = run.Status, ["score"] = run.Score, ["recordsFlagged"] = run.RecordsFlagged,
            ["probesRun"] = run.ProbesRun, ["reports"] = new JsonArray(formats.Select(f => (JsonNode)f).ToArray()),
            ["error"] = run.Error,
        };
    }

    private async Task StoreFailedRunAsync(AiFeatureJob job, JsonElement options, DateTime started, string error)
    {
        var runId = DataAnomalyService.Str(options, "runId") ?? DataAnomalyService.NewRunId();
        if (await db.AnomalyRuns.AnyAsync(r => r.TenantId == job.TenantId && r.RunId == runId)) return;
        db.AnomalyRuns.Add(new AnomalyRun
        {
            TenantId = job.TenantId, RunId = runId, Status = "failed", StartedAt = started, FinishedAt = DateTime.UtcNow,
            Error = DataAnomalyService.Clip(error, 4000), StartedBy = job.RequestedBy,
        });
        await db.SaveChangesAsync();
    }

    /// <summary>New proposals wait for an admin; one already known (same hash) is not added twice.</summary>
    private async Task<JsonObject> StoreProposalsAsync(long tenantId, JsonElement result)
    {
        var known = (await db.AnomalyProposals.AsNoTracking().Where(p => p.TenantId == tenantId).Select(p => p.ProposalHash).ToListAsync())
            .ToHashSet(StringComparer.Ordinal);
        var added = 0;
        if (result.TryGetProperty("proposals", out var proposals) && proposals.ValueKind == JsonValueKind.Array)
        {
            foreach (var p in proposals.EnumerateArray().Where(p => p.ValueKind == JsonValueKind.Object))
            {
                var hash = DataAnomalyService.Str(p, "hash")?.Trim();
                if (string.IsNullOrEmpty(hash) || hash.Length > 64 || !known.Add(hash)) continue;
                db.AnomalyProposals.Add(new AnomalyProposal
                {
                    TenantId = tenantId, ProposalHash = hash, Status = "pending",
                    Title = DataAnomalyService.Clip(DataAnomalyService.Str(p, "title")?.Trim(), 400) is { Length: > 0 } t ? t : hash,
                    ProposalJson = p.GetRawText(), CreatedAt = DateTime.UtcNow,
                });
                added++;
            }
        }
        await db.SaveChangesAsync();
        var summary = Pick(result, "dropped", "seconds", "llmCalls");
        summary["proposals"] = added;
        return summary;
    }

    // ── JSON helpers ───────────────────────────────────────────────────────────────────────────────────────────────

    private static JsonObject Pick(JsonElement e, params string[] names)
    {
        var o = new JsonObject();
        foreach (var n in names)
            if (e.TryGetProperty(n, out var v))
                o[n] = v.ValueKind == JsonValueKind.Array && v.GetArrayLength() > 50
                    ? v.GetArrayLength()                                   // a long list: its length is enough here
                    : JsonNode.Parse(v.GetRawText());
        return o;
    }

    private static JsonNode? Node(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? JsonNode.Parse(v.GetRawText()) : null;

    private static bool Bool(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static JsonElement? At(JsonElement e, string path)
    {
        foreach (var part in path.Split('.'))
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(part, out e)) return null;
        }
        return e;
    }

    private static long? Long(JsonElement e, params string[] paths)
    {
        foreach (var p in paths)
            if (At(e, p) is { ValueKind: JsonValueKind.Number } v && v.TryGetDouble(out var d)) return (long)Math.Round(d);
        return null;
    }

    private static decimal? Decimal(JsonElement e, string path) =>
        At(e, path) is { ValueKind: JsonValueKind.Number } v && v.TryGetDecimal(out var d) ? Math.Round(Math.Clamp(d, -9999.99m, 9999.99m), 2) : null;

    /// <summary>A text field, or an object's "name" (the database may be reported as {name, server}).</summary>
    private static string? Text(JsonElement e, string name) => At(e, name) switch
    {
        { ValueKind: JsonValueKind.String } v => v.GetString(),
        { ValueKind: JsonValueKind.Object } o => DataAnomalyService.Str(o, "name"),
        _ => null,
    };

    [GeneratedRegex(@"^(.+)-\d{3}$")]
    private static partial Regex FamilyMember();
}
