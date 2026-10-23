using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
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
    private readonly ConcurrentQueue<long> _claimed = new();
    private volatile bool _runsJobsHere;

    public void Notify()
    {
        try { _signal.Release(); }
        catch (SemaphoreFullException) { }   // already signalled
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);

    public bool RunsJobsHere => _runsJobsHere;

    public void Claimed(long jobId)
    {
        _claimed.Enqueue(jobId);
        Notify();
    }

    internal void SetRunsJobsHere(bool value) => _runsJobsHere = value;

    internal bool TryTakeClaimed(out long jobId) => _claimed.TryDequeue(out jobId);
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

        var missingTables = false;
        var local = signal as AgenticJobSignal;
        local?.SetRunsJobsHere(true);
        while (!stoppingToken.IsCancellationRequested)
        {
            var wait = poll;
            try
            {
                await FailStaleAsync(stale, stoppingToken);
                // Jobs started on this instance were created already claimed: they run here, never elsewhere.
                while (local is not null && local.TryTakeClaimed(out var mine))
                    _running[mine] = Task.Run(() => RunAsync(mine, stoppingToken), CancellationToken.None);
                while (_running.Count < maxParallel && await ClaimAsync(stoppingToken) is { } id)
                    _running[id] = Task.Run(() => RunAsync(id, stoppingToken), CancellationToken.None);
                if (missingTables) logger.LogInformation("Agentic Features: the job queue table is there now; jobs run again.");
                missingTables = false;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (SqlException ex) when (ex.Number == 208)
            {
                // core.AiFeatureJob does not exist yet: say so once, then look again every minute (no log flood).
                if (!missingTables)
                    logger.LogWarning("Agentic Features: the tenant database has no core.AiFeatureJob table yet. Run " +
                        "smartops/infra/sql/add-agentic-features.sql on it; Data Anomaly jobs start once it exists.");
                missingTables = true;
                wait = TimeSpan.FromMinutes(1);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Agentic Features: could not read the job queue");
            }
            try { await signal.WaitAsync(wait, stoppingToken); }
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
    IAiUsageRepository usage, IConfiguration config, ILogger<AgenticJobRunner> logger)
{
    private static readonly TimeSpan BeatEvery = TimeSpan.FromSeconds(10);
    private const int MaxCoveredChecks = 1000;
    /// <summary>Compiled checks written per round trip: a dropped connection loses one small batch, not the whole catalog.</summary>
    internal const int ProbeBatchSize = 25;
    /// <summary>Waits between attempts to store a job's outcome after the database connection dropped (about 2 minutes in
    /// all, well inside the stale-job limit; the job's heartbeat is kept current meanwhile).</summary>
    /// <summary>A probe kept during the compile retries briefly: the whole catalog is written again at the end anyway.</summary>
    internal static TimeSpan[] ProbeRetryDelays { get; set; } = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5)];
    internal static TimeSpan[] StoreRetryDelays { get; set; } =
        [TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(40), TimeSpan.FromSeconds(60)];
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
        string? latestProgress = null, storedProgress = null;
        var started = DateTime.UtcNow;
        var options = DataAnomalyService.Parse(job.RequestJson) ?? JsonSerializer.Deserialize<JsonElement>("{}");

        async Task BeatAsync(string? progress)
        {
            var now = DateTime.UtcNow;
            // A progress update that arrives too soon is kept and written by the next beat (a ping, a stored probe or
            // the next progress), so the page never stays on an old count while rules finish in parallel.
            if (progress is not null) latestProgress = progress;
            var changed = latestProgress != storedProgress;
            if (!changed && now - lastBeat < BeatEvery) return;
            if (changed && now - lastBeat < TimeSpan.FromSeconds(2)) return;   // progress at most every 2 s
            lastBeat = now;
            var stored = latestProgress;
            storedProgress = stored;
            int alive;
            try
            {
                alive = await db.AiFeatureJobs.Where(j => j.Id == jobId && j.Status == AiFeatureJobStatus.Running)
                    .ExecuteUpdateAsync(x => x.SetProperty(j => j.HeartbeatAt, now).SetProperty(j => j.ProgressJson, stored), CancellationToken.None);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A database hiccup on a heartbeat must not end a long job: the next beat tries again (a job that is
                // really gone is still caught by the stale check after StaleJobMinutes).
                logger.LogWarning("Data Anomaly job {JobId}: heartbeat not saved ({Error}); the job continues.", jobId, ex.GetType().Name);
                return;
            }
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
            var pending = new PendingJobResults(config, logger);
            var pendingKey = PendingJobResults.Key(job.Kind, body, envelope);

            // An earlier job with the same input finished its AI work but could not store it (database connection
            // lost): store that outcome now instead of paying for the AI work again.
            if (PendingJobResults.Applies(job.Kind) && pending.TryLoad(job.TenantId, job.Feature, job.Kind, pendingKey) is { } saved)
            {
                logger.LogInformation("Data Anomaly {Kind} job {JobId}: storing the outcome job {EarlierJob} could not save ({SavedAt:u}), "
                    + "without calling the AI again.", job.Kind, job.Id, saved.JobId, saved.SavedAt);
                await BeatAsync(JsonSerializer.Serialize(new { stage = "store", label = "Saving the result of the earlier job" }));
                await CompleteAsync(job, options, saved.Result, started, pending, pendingKey, () => BeatAsync(null));
                return;
            }

            JsonElement? result = null;
            string? error = null;
            await foreach (var ev in runtime.FeatureStreamAsync(job.Feature, job.Kind, envelope, body, cts.Token))
            {
                switch (ev.Type)
                {
                    case "progress":
                        await BeatAsync(ev.Data.GetRawText());
                        break;
                    case "probe" when job.Kind == DataAnomalyService.KindCompile && ev.Data.TryGetProperty("probe", out var probe):
                        // Kept at once: a compile cut short (restart, lost connection) is resumed from these.
                        await SaveProbeAsync(job, probe);
                        await BeatAsync(null);
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
                await CompleteAsync(job, options, r, started, pending, pendingKey, () => BeatAsync(null));
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

    /// <summary>
    /// Stores a job's outcome, logs its AI usage and closes the job. A dropped database connection is retried with a fresh
    /// connection (StoreRetryDelays). If the outcome of a compile or discover still cannot be stored, it is kept on disk
    /// (PendingJobResults) and the job fails with a message saying so: starting the same job again stores it without
    /// calling the AI. AI usage is logged only once the outcome is stored, so a kept outcome is not counted twice.
    /// </summary>
    private async Task CompleteAsync(AiFeatureJob job, JsonElement options, JsonElement result, DateTime started,
        PendingJobResults pending, string pendingKey, Func<Task> heartbeat)
    {
        JsonObject summary;
        try
        {
            summary = await WithDatabaseRetryAsync($"job {job.Id}: store the outcome", () => StoreAsync(job, options, result, started), heartbeat);
        }
        catch (Exception ex) when (IsTransient(ex) && PendingJobResults.Applies(job.Kind))
        {
            var kept = pending.Save(job.TenantId, job.Feature, job.Kind, pendingKey, job.Id, result);
            logger.LogError(ex, "Data Anomaly {Kind} job {JobId}: the outcome could not be stored (database connection lost); kept: {Kept}",
                job.Kind, job.Id, kept);
            var what = job.Kind == DataAnomalyService.KindCompile ? "The checks were compiled" : "New rules were proposed";
            await FinishAsync(job.Id, AiFeatureJobStatus.Failed, null, kept
                ? $"{what} but could not be saved: the connection to the database was lost. Start it again with the same options: "
                  + $"the result is saved then, without calling the AI again (kept for {pending.KeepHours} hours)."
                : $"{what} but could not be saved: the connection to the database was lost. Start it again.");
            return;
        }

        pending.Delete(job.TenantId, job.Feature, job.Kind);
        try
        {
            await WithDatabaseRetryAsync($"job {job.Id}: log AI usage", async () =>
            {
                await AgenticFeatureGateway.LogUsageAsync(usage, job.TenantId, job.RequestedBy, job.Feature, result);
                return true;
            }, heartbeat);
        }
        catch (Exception ex)
        {
            // The outcome is stored; missing usage rows only make today's AI count low.
            logger.LogWarning(ex, "Data Anomaly job {JobId}: AI usage could not be logged", job.Id);
        }
        await FinishAsync(job.Id, AiFeatureJobStatus.Succeeded, summary, null);
        logger.LogInformation("Data Anomaly {Kind} job {JobId} finished for tenant {TenantId}.", job.Kind, job.Id, job.TenantId);
    }

    /// <summary>Runs a database step again after a dropped connection or a timeout, with a fresh change tracker (the
    /// failed attempt's transaction was rolled back) and the job's heartbeat kept current while it waits.</summary>
    private async Task<T> WithDatabaseRetryAsync<T>(string what, Func<Task<T>> step, Func<Task>? heartbeat = null,
        TimeSpan[]? delays = null)
    {
        delays ??= StoreRetryDelays;
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await step();
            }
            catch (Exception ex) when (IsTransient(ex) && attempt < delays.Length)
            {
                db.ChangeTracker.Clear();
                var wait = delays[attempt];
                logger.LogWarning("Data Anomaly {What}: database connection problem ({Error}); attempt {Attempt} of {Total} in {Wait}s.",
                    what, ex.GetBaseException().Message, attempt + 2, delays.Length + 1, wait.TotalSeconds);
                await Task.Delay(wait);
                if (heartbeat is not null)
                {
                    try { await heartbeat(); } catch (Exception) { /* the heartbeat logs its own problems */ }
                }
            }
        }
    }

    /// <summary>A failure that a new attempt on a fresh connection can get past: the connection dropped or timed out.
    /// Constraint violations and SQL errors are not.</summary>
    internal static bool IsTransient(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException)
        {
            switch (e)
            {
                case SqlException sql when sql.Class >= 20 || TransientSqlNumbers.Contains(sql.Number):
                case TimeoutException:
                case IOException:
                case System.Net.Sockets.SocketException:
                case System.ComponentModel.Win32Exception:
                    return true;
                case SqlException:
                    return false;
            }
        }
        return false;
    }

    /// <summary>Timeout (-2), connection broken / forcibly closed / network name gone (64, 233, 10053, 10054, 10060),
    /// Azure SQL busy or throttling (40197, 40501, 40613, 49918, 49919, 49920).</summary>
    private static readonly HashSet<int> TransientSqlNumbers = [-2, 64, 233, 10053, 10054, 10060, 40197, 40501, 40613, 49918, 49919, 49920];

    /// <summary>Closes the job unless someone already did (cancelled, or failed as stale). Retried on a dropped
    /// connection: otherwise a finished job would stay "running" until the stale check fails it.</summary>
    private async Task FinishAsync(long jobId, string status, JsonObject? result, string? error)
    {
        var resultJson = result?.ToJsonString(DataAnomalyService.Json);
        var message = DataAnomalyService.Clip(error, 4000);
        await WithDatabaseRetryAsync($"job {jobId}: close", async () =>
        {
            var now = DateTime.UtcNow;
            return await db.AiFeatureJobs.Where(j => j.Id == jobId && j.Status == AiFeatureJobStatus.Running)
                .ExecuteUpdateAsync(x => x.SetProperty(j => j.Status, status).SetProperty(j => j.FinishedAt, now)
                    .SetProperty(j => j.HeartbeatAt, now).SetProperty(j => j.ResultJson, resultJson).SetProperty(j => j.Error, message),
                    CancellationToken.None);
        });
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

    private HashSet<string>? _ruleIds;

    /// <summary>
    /// Stores one probe the moment the compile finished it (insert, or replace the tenant's probe with that id). The next
    /// compile sends the stored catalog back, and the runtime reuses every probe still valid, so a compile cut short
    /// continues where it stopped. Retried on a dropped connection; a probe that still cannot be stored is only logged:
    /// the complete catalog is written again when the compile ends.
    /// </summary>
    private async Task SaveProbeAsync(AiFeatureJob job, JsonElement probe)
    {
        var id = DataAnomalyService.Str(probe, "ruleId")?.Trim();
        if (probe.ValueKind != JsonValueKind.Object || string.IsNullOrEmpty(id) || id.Length > 200) return;
        try
        {
            await WithDatabaseRetryAsync($"job {job.Id}: keep probe {id}", async () =>
            {
                _ruleIds ??= (await db.AnomalyRules.AsNoTracking().Where(r => r.TenantId == job.TenantId).Select(r => r.RuleId)
                    .ToListAsync()).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var row = await db.AnomalyProbes.FirstOrDefaultAsync(p => p.TenantId == job.TenantId && p.ProbeId == id);
                if (row is null)
                {
                    row = new AnomalyProbe { TenantId = job.TenantId, ProbeId = id };
                    db.AnomalyProbes.Add(row);
                }
                Fill(row, probe, _ruleIds);
                await db.SaveChangesAsync();
                db.ChangeTracker.Clear();
                return true;
            }, delays: ProbeRetryDelays);
        }
        catch (Exception ex)
        {
            db.ChangeTracker.Clear();
            logger.LogWarning(ex, "Data Anomaly job {JobId}: probe {ProbeId} could not be kept yet; it is stored with the whole catalog "
                + "when the compile ends", job.Id, id);
        }
    }

    private static void Fill(AnomalyProbe row, JsonElement probe, IReadOnlySet<string> ruleIds)
    {
        var status = DataAnomalyService.Str(probe, "status") ?? "failed";
        row.RuleId = OwnerRule(row.ProbeId, ruleIds);
        row.Status = ProbeStatuses.Contains(status) ? status : "failed";
        row.ProbeJson = probe.GetRawText();
        row.CompiledAt = DateTime.TryParse(DataAnomalyService.Str(probe, "compiledAt"), CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at) ? at : DateTime.UtcNow;
    }

    /// <summary>The catalog after a compile is complete: it replaces the stored one.</summary>
    private async Task ReplaceCatalogAsync(long tenantId, JsonElement catalog)
    {
        var ruleIds = (await db.AnomalyRules.AsNoTracking().Where(r => r.TenantId == tenantId).Select(r => r.RuleId).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        await db.AnomalyProbes.Where(p => p.TenantId == tenantId).ExecuteDeleteAsync();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var batch = 0;
        foreach (var probe in catalog.EnumerateArray().Where(p => p.ValueKind == JsonValueKind.Object))
        {
            var id = DataAnomalyService.Str(probe, "ruleId")?.Trim();
            if (string.IsNullOrEmpty(id) || id.Length > 200 || !seen.Add(id)) continue;
            var row = new AnomalyProbe { TenantId = tenantId, ProbeId = id };
            Fill(row, probe, ruleIds);
            db.AnomalyProbes.Add(row);
            // Small round trips inside the one transaction: the catalog is still replaced all or nothing.
            if (++batch % ProbeBatchSize == 0)
            {
                await db.SaveChangesAsync();
                db.ChangeTracker.Clear();
            }
        }
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
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
        var probesRun = (int?)Long(result, "probesRun", "totals.probes_run", "totals.probesRun", "totals.probes");
        // A failed run, or one where no check ran, has no score: the formula would read 100 on no data.
        var scored = string.IsNullOrWhiteSpace(error) && probesRun is > 0;
        var run = new AnomalyRun
        {
            TenantId = job.TenantId, RunId = runId, Status = string.IsNullOrWhiteSpace(error) ? "succeeded" : "failed",
            DatabaseName = DataAnomalyService.Clip(Text(result, "database"), 200), StartedAt = started, FinishedAt = DateTime.UtcNow,
            Score = scored ? Decimal(result, "score") : null, ProbesRun = probesRun,
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

/// <summary>
/// The outcome of a compile or discover whose AI work finished but could not be stored (the database connection was
/// lost), kept as a file so the next job with the same input stores it instead of calling the AI again. One file per
/// tenant, feature and kind under AgenticFeatures:PendingResultsDir (default: the user's local app data
/// \TWise\agentic-pending), kept AgenticFeatures:PendingResultHours (24). The key covers everything the outcome was
/// computed from (rules, compiled checks, options, settings, readable tables, prompts), so a changed input never
/// reuses it. The files hold SQL and rule text, no secrets.
/// </summary>
public sealed class PendingJobResults(IConfiguration config, ILogger logger)
{
    public sealed record Saved(long JobId, DateTime SavedAt, JsonElement Result);

    public int KeepHours { get; } = int.TryParse(config["AgenticFeatures:PendingResultHours"], out var h) ? Math.Clamp(h, 1, 168) : 24;

    private string Dir => config["AgenticFeatures:PendingResultsDir"] is { Length: > 0 } d ? d
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TWise", "agentic-pending");

    /// <summary>Compile and discover are the jobs whose AI work is worth keeping; a run is cheap to repeat and its
    /// result belongs to the moment it ran.</summary>
    public static bool Applies(string kind) => kind is DataAnomalyService.KindCompile or DataAnomalyService.KindDiscover;

    /// <summary>SHA-256 of what the outcome depends on (the run id, new per job, left out).</summary>
    public static string Key(string kind, JsonObject body, AgenticFeatureEnvelope envelope)
    {
        var input = (JsonObject)body.DeepClone();
        input.Remove("runId");
        var text = JsonSerializer.Serialize(new
        {
            kind, body = input.ToJsonString(), settings = envelope.Settings, access = envelope.Access,
            prompts = envelope.Prompts.OrderBy(p => p.Key, StringComparer.Ordinal).ToList(),
        });
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    }

    public Saved? TryLoad(long tenantId, string feature, string kind, string key)
    {
        var path = PathFor(tenantId, feature, kind);
        try
        {
            if (!File.Exists(path)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var savedAt = root.GetProperty("savedAt").GetDateTime();
            if (DateTime.UtcNow - savedAt > TimeSpan.FromHours(KeepHours))
            {
                Delete(tenantId, feature, kind);
                return null;
            }
            if (root.GetProperty("key").GetString() != key) return null;   // the input changed: the AI must run again
            return new Saved(root.GetProperty("jobId").GetInt64(), savedAt, root.GetProperty("result").Clone());
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or KeyNotFoundException
            or InvalidOperationException or FormatException)
        {
            logger.LogWarning(ex, "Agentic Features: the kept result {Path} could not be read; it is ignored", path);
            return null;
        }
    }

    /// <summary>Writes the outcome (to a temporary file first, so a half-written file is never read). False when it
    /// could not be written.</summary>
    public bool Save(long tenantId, string feature, string kind, string key, long jobId, JsonElement result)
    {
        var path = PathFor(tenantId, feature, kind);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(new { key, jobId, savedAt = DateTime.UtcNow, result }));
            File.Move(tmp, path, overwrite: true);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Agentic Features: the result of job {JobId} could not be kept in {Path}", jobId, path);
            return false;
        }
    }

    public void Delete(long tenantId, string feature, string kind)
    {
        try { File.Delete(PathFor(tenantId, feature, kind)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private string PathFor(long tenantId, string feature, string kind) =>
        Path.Combine(Dir, $"tenant-{tenantId}-{feature}-{kind}.json");
}
