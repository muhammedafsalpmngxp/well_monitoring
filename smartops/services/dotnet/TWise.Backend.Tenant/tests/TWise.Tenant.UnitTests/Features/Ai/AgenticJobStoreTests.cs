using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>
/// Storing a Data Anomaly job's outcome when the database connection is unreliable: which failures are retried, and the
/// kept outcome of a compile / discover that could not be stored, reused by the next job with the same input.
/// </summary>
public sealed class AgenticJobStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "agentic-pending-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private PendingJobResults Pending(int? keepHours = null) => new(new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["AgenticFeatures:PendingResultsDir"] = _dir,
            ["AgenticFeatures:PendingResultHours"] = keepHours?.ToString(),
        }).Build(), NullLogger.Instance);

    private static AgenticFeatureEnvelope Envelope(string prompt = "Write the SQL.") => new(null,
        new Dictionary<string, string> { ["anomaly.author_system"] = prompt },
        new Dictionary<string, JsonElement> { ["runConcurrency"] = JsonSerializer.SerializeToElement(1) },
        FeatureAccessDto.Empty, new Dictionary<string, FeatureQueryPayload>());

    private static JsonObject Body(string rule = "DQ-A01", string? runId = null)
    {
        var body = new JsonObject { ["rules"] = new JsonArray(new JsonObject { ["ruleId"] = rule }), ["catalog"] = new JsonArray() };
        if (runId is not null) body["runId"] = runId;
        return body;
    }

    private static JsonElement Result => JsonSerializer.SerializeToElement(new { catalog = new[] { new { ruleId = "DQ-A01", status = "active" } } });

    // ── Which failures are retried ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_dropped_connection_or_a_timeout_is_retried_wherever_it_is_wrapped()
    {
        AgenticJobRunner.IsTransient(new TimeoutException()).Should().BeTrue();
        AgenticJobRunner.IsTransient(new IOException("The specified network name is no longer available.")).Should().BeTrue();
        AgenticJobRunner.IsTransient(new DbUpdateException("save failed", new IOException("connection reset"))).Should().BeTrue();
        AgenticJobRunner.IsTransient(new System.ComponentModel.Win32Exception(64)).Should().BeTrue();
    }

    [Fact]
    public void A_logic_error_is_not_retried()
    {
        AgenticJobRunner.IsTransient(new InvalidOperationException("bad state")).Should().BeFalse();
        AgenticJobRunner.IsTransient(new DbUpdateException("duplicate key", new InvalidOperationException())).Should().BeFalse();
        AgenticJobRunner.IsTransient(new JsonException()).Should().BeFalse();
    }

    [Fact]
    public void A_probe_kept_during_a_compile_retries_briefly_and_the_final_store_waits_longer_but_inside_the_stale_limit()
    {
        AgenticJobRunner.ProbeRetryDelays.Sum(d => d.TotalSeconds).Should().BeLessThan(15);
        AgenticJobRunner.StoreRetryDelays.Sum(d => d.TotalSeconds).Should().BeLessThan(TimeSpan.FromMinutes(5).TotalSeconds);
    }

    // ── Jobs started on this instance ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_job_claimed_here_is_handed_to_this_instances_worker_and_wakes_it()
    {
        var signal = new AgenticJobSignal();
        signal.RunsJobsHere.Should().BeFalse("no worker has started yet: jobs are queued for any instance");
        signal.SetRunsJobsHere(true);
        signal.RunsJobsHere.Should().BeTrue();

        signal.Claimed(21);
        signal.Claimed(22);

        var woken = signal.WaitAsync(TimeSpan.FromSeconds(1), CancellationToken.None);
        (await Task.WhenAny(woken, Task.Delay(2000))).Should().BeSameAs(woken);
        signal.TryTakeClaimed(out var first).Should().BeTrue();
        signal.TryTakeClaimed(out var second).Should().BeTrue();
        signal.TryTakeClaimed(out _).Should().BeFalse();
        (first, second).Should().Be((21L, 22L));
    }

    // ── The kept outcome ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Only_compile_and_discover_outcomes_are_kept()
    {
        PendingJobResults.Applies("compile").Should().BeTrue();
        PendingJobResults.Applies("discover").Should().BeTrue();
        PendingJobResults.Applies("run").Should().BeFalse();
    }

    [Fact]
    public void A_kept_outcome_is_returned_to_the_next_job_with_the_same_input()
    {
        var pending = Pending();
        var key = PendingJobResults.Key("compile", Body(), Envelope());
        pending.Save(2, "anomaly", "compile", key, jobId: 17, Result).Should().BeTrue();

        var saved = pending.TryLoad(2, "anomaly", "compile", PendingJobResults.Key("compile", Body(), Envelope()));

        saved.Should().NotBeNull();
        saved!.JobId.Should().Be(17);
        saved.Result.GetProperty("catalog")[0].GetProperty("ruleId").GetString().Should().Be("DQ-A01");
    }

    [Fact]
    public void A_changed_rule_prompt_or_other_tenant_does_not_reuse_a_kept_outcome()
    {
        var pending = Pending();
        pending.Save(2, "anomaly", "compile", PendingJobResults.Key("compile", Body(), Envelope()), 17, Result);

        pending.TryLoad(2, "anomaly", "compile", PendingJobResults.Key("compile", Body("DQ-B02"), Envelope())).Should().BeNull();
        pending.TryLoad(2, "anomaly", "compile", PendingJobResults.Key("compile", Body(), Envelope("Other text."))).Should().BeNull();
        pending.TryLoad(3, "anomaly", "compile", PendingJobResults.Key("compile", Body(), Envelope())).Should().BeNull();
        pending.TryLoad(2, "anomaly", "discover", PendingJobResults.Key("discover", Body(), Envelope())).Should().BeNull();
    }

    [Fact]
    public void The_run_id_does_not_change_the_key()
    {
        PendingJobResults.Key("compile", Body(runId: "run-1"), Envelope())
            .Should().Be(PendingJobResults.Key("compile", Body(runId: "run-2"), Envelope()));
    }

    [Fact]
    public void A_deleted_or_expired_outcome_is_not_reused()
    {
        var key = PendingJobResults.Key("compile", Body(), Envelope());
        var pending = Pending();
        pending.Save(2, "anomaly", "compile", key, 17, Result);
        pending.Delete(2, "anomaly", "compile");
        pending.TryLoad(2, "anomaly", "compile", key).Should().BeNull();

        // Written 2 hours ago, kept 1 hour: expired, and the file is removed.
        pending.Save(2, "anomaly", "compile", key, 18, Result);
        var file = Directory.GetFiles(_dir).Single();
        var json = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
        json["savedAt"] = DateTime.UtcNow.AddHours(-2);
        File.WriteAllText(file, json.ToJsonString());

        Pending(keepHours: 1).TryLoad(2, "anomaly", "compile", key).Should().BeNull();
        File.Exists(file).Should().BeFalse();
    }

    [Fact]
    public void An_unreadable_kept_file_is_ignored()
    {
        var pending = Pending();
        var key = PendingJobResults.Key("compile", Body(), Envelope());
        pending.Save(2, "anomaly", "compile", key, 17, Result);
        File.WriteAllText(Directory.GetFiles(_dir).Single(), "{ not json");

        pending.TryLoad(2, "anomaly", "compile", key).Should().BeNull();
    }
}
