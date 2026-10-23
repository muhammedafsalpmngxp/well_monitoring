using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.SelfHealing;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;
using TWise.Tenant.Infrastructure.Persistence.Configurations;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.SelfHealing;

/// <summary>Self-Healing step 1: every chart and saved-view load is timed into the run log without slowing the load.</summary>
public sealed class ViewRunLogTests
{
    private static readonly SelfHealingOptions Options = new()
    {
        RecordRuns = true, QueueCapacity = 10, BatchSize = 10, FlushSeconds = 5, RetentionDays = 30, CleanupHours = 6,
        SlowMs = 5000, SqlLength = 20, Days = [7, 30, 90], TopViews = 10, LogRows = 500, StaleDays = 7,
    };

    private static ViewRun Run() => new() { SourceName = "vw_wells", SourceType = "View", Caller = ViewRunCallers.Chart };

    private static (Mock<IViewRunRecorder> Recorder, List<ViewRun> Recorded) Recorder()
    {
        var recorded = new List<ViewRun>();
        var recorder = new Mock<IViewRunRecorder>();
        recorder.Setup(r => r.Record(It.IsAny<ViewRun>())).Callback<ViewRun>(recorded.Add);
        return (recorder, recorded);
    }

    [Fact]
    public async Task A_load_is_recorded_with_its_rows()
    {
        var (recorder, recorded) = Recorder();
        var result = await recorder.Object.TimeAsync(Run(), () => Task.FromResult<int[]?>([1, 2, 3]), r => (r!.Length, null));

        result.Should().HaveCount(3);
        recorded.Should().ContainSingle().Which.Should().Match<ViewRun>(r => r.RowCount == 3 && r.Error == null && r.DurationMs >= 0);
    }

    [Fact]
    public async Task A_load_that_returns_nothing_is_recorded_as_failed()
    {
        var (recorder, recorded) = Recorder();
        await recorder.Object.TimeAsync(Run(), () => Task.FromResult<int[]?>(null), r => r is null ? (null, ViewRunTiming.NoResult) : (r.Length, null));

        recorded.Single().Error.Should().Be(ViewRunTiming.NoResult);
    }

    [Fact]
    public async Task A_failing_load_is_recorded_and_still_throws()
    {
        var (recorder, recorded) = Recorder();
        var load = () => recorder.Object.TimeAsync<int[]?>(Run(), () => throw new InvalidOperationException("Invalid column name 'x'."), _ => (null, null));

        await load.Should().ThrowAsync<InvalidOperationException>();
        recorded.Single().Error.Should().Be("Invalid column name 'x'.");
    }

    [Fact]
    public async Task A_cancelled_load_is_not_recorded()
    {
        var (recorder, recorded) = Recorder();
        var load = () => recorder.Object.TimeAsync<int[]?>(Run(), () => throw new OperationCanceledException(), _ => (null, null));

        await load.Should().ThrowAsync<OperationCanceledException>();
        recorded.Should().BeEmpty();
    }

    [Fact]
    public async Task Chart_loads_are_recorded_with_the_source_and_user()
    {
        var (recorder, recorded) = Recorder();
        var repo = new Mock<ISourceRepository>();
        repo.Setup(r => r.GetFilteredChartDataAsync(It.IsAny<ChartFilteredDataRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TableDataDto(["a"], [new() { ["a"] = 1 }, new() { ["a"] = 2 }]));
        var user = Mock.Of<ICurrentUserService>(u => u.UserId == "42");

        await new SourceService(repo.Object, recorder.Object, user).GetFilteredChartDataAsync(new ChartFilteredDataRequest("vw_wells", "View", 7, []));

        recorded.Single().Should().Match<ViewRun>(r =>
            r.ViewId == 7 && r.SourceName == "vw_wells" && r.SourceType == "View" && r.Caller == ViewRunCallers.Chart && r.UserId == 42 && r.RowCount == 2);
    }

    [Fact]
    public async Task The_sql_the_load_sends_is_kept_on_the_run()
    {
        var (recorder, recorded) = Recorder();
        await recorder.Object.TimeAsync(Run(), () => { ViewRunTiming.NoteSql("SELECT * FROM v WHERE d >= @pFrom"); return Task.FromResult(1); }, _ => (1, null));
        ViewRunTiming.NoteSql("SELECT 'outside a timed load'");

        recorded.Single().Sql.Should().Be("SELECT * FROM v WHERE d >= @pFrom");
    }

    [Fact]
    public async Task A_load_the_outcome_skips_is_not_recorded()
    {
        var (recorder, recorded) = Recorder();
        await recorder.Object.TimeAsync<int?>(Run(), () => Task.FromResult<int?>(null), r => r is null ? null : (r, null));

        recorded.Should().BeEmpty();
    }

    [Fact]
    public async Task A_wrapped_database_error_keeps_the_original_message()
    {
        var (recorder, recorded) = Recorder();
        var load = () => recorder.Object.TimeAsync<int>(Run(),
            () => throw new InvalidOperationException("A filter value does not match.", new FormatException("Conversion failed for 'abc'.")), _ => (null, null));

        await load.Should().ThrowAsync<InvalidOperationException>();
        recorded.Single().Error.Should().Be("A filter value does not match. (Conversion failed for 'abc'.)");
    }

    [Fact]
    public void Sql_is_kept_only_for_failed_or_slow_runs_and_cut()
    {
        var log = new ViewRunLog(Mock.Of<IDbContextFactory<TenantDbContext>>(), Options, NullLogger<ViewRunLog>.Instance);
        ViewRun With(string? error, int ms) { var r = Run(); r.Error = error; r.DurationMs = ms; r.Sql = new string('s', 30); log.Record(r); return r; }

        With(null, 10).Sql.Should().BeNull();
        With(null, Options.SlowMs).Sql.Should().HaveLength(Options.SqlLength);
        With("boom", 10).Sql.Should().HaveLength(Options.SqlLength);
    }

    [Fact]
    public async Task Runs_are_written_in_batches_and_a_full_queue_drops_new_runs()
    {
        var dbs = new Mock<IDbContextFactory<TenantDbContext>>();
        dbs.Setup(f => f.CreateDbContextAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("no database"));
        var log = new ViewRunLog(dbs.Object, Options with { QueueCapacity = 3, BatchSize = 2 }, NullLogger<ViewRunLog>.Instance);

        for (var i = 0; i < 5; i++) log.Record(Run());
        await log.FlushAsync(CancellationToken.None);

        // 3 queued (2 dropped), written as 2 + 1; a failed write is logged, never thrown.
        dbs.Verify(f => f.CreateDbContextAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task Nothing_is_queued_when_recording_is_off_and_long_errors_are_cut()
    {
        var dbs = new Mock<IDbContextFactory<TenantDbContext>>();
        var off = new ViewRunLog(dbs.Object, Options with { RecordRuns = false }, NullLogger<ViewRunLog>.Instance);
        off.Record(Run());
        await off.FlushAsync(CancellationToken.None);
        dbs.Verify(f => f.CreateDbContextAsync(It.IsAny<CancellationToken>()), Times.Never);

        var run = Run();
        run.Error = new string('x', ViewRunConfiguration.ErrorLength + 50);
        new ViewRunLog(dbs.Object, Options, NullLogger<ViewRunLog>.Instance).Record(run);
        run.Error.Should().HaveLength(ViewRunConfiguration.ErrorLength);
    }

    [Fact]
    public void The_period_must_be_one_the_page_offers()
    {
        var validator = new GetSelfHealingOverviewQueryValidator(Options);

        validator.Validate(new GetSelfHealingOverviewQuery(2, null)).IsValid.Should().BeTrue();
        validator.Validate(new GetSelfHealingOverviewQuery(2, 30)).IsValid.Should().BeTrue();
        validator.Validate(new GetSelfHealingOverviewQuery(2, 365)).Errors.Single().ErrorMessage.Should().Be("Days must be one of 7, 30, 90.");
    }

    [Fact]
    public void Every_setting_is_required()
    {
        var settings = new Dictionary<string, string?>
        {
            ["SelfHealing:RecordRuns"] = "true", ["SelfHealing:QueueCapacity"] = "5000", ["SelfHealing:BatchSize"] = "200",
            ["SelfHealing:FlushSeconds"] = "5", ["SelfHealing:RetentionDays"] = "30", ["SelfHealing:CleanupHours"] = "6",
            ["SelfHealing:SlowMs"] = "5000", ["SelfHealing:SqlLength"] = "20000", ["SelfHealing:Days:0"] = "7", ["SelfHealing:Days:1"] = "30",
            ["SelfHealing:TopViews"] = "10", ["SelfHealing:LogRows"] = "500",
        };
        var build = () => SelfHealingOptions.From(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        build.Should().Throw<InvalidOperationException>().WithMessage("SelfHealing:StaleDays must be set*");

        settings["SelfHealing:StaleDays"] = "7";
        build().Days.Should().Equal(7, 30);
    }
}
