using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class RunModelQueryHandlerTests
{
    private static readonly QueryRequest ByTask = new(1, ["TaskDaily.task_code"], ["Task Count"]);
    private static readonly QueryRequest ByCrew = new(1, ["CrewType.code"], ["Task Count"]);

    private readonly ModelCache _cache = NewCache();
    private readonly Mock<IDatasetRepository> _repo =
        Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews(), Measure(5, "Task Count", TaskCount)));
    private readonly Mock<IModelQueryService> _runner = new();
    private int _runs;
    private Func<QueryResult> _answer;

    public RunModelQueryHandlerTests()
    {
        // Each run that reaches the "database" is counted and read one minute after the previous one.
        _answer = () => new QueryResult(["TaskDaily.task_code", "Task Count"], [], new DateTime(2026, 9, 21, 10, _runs, 0, DateTimeKind.Utc));
        _runner.Setup(r => r.RunAsync(It.IsAny<CompiledQuery>(), It.IsAny<DatabaseConnection>(), TenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => { _runs++; return _answer(); });
    }

    [Fact]
    public async Task The_same_question_is_answered_from_the_cache_without_the_database()
    {
        var first = await Run(ByTask);
        var second = await Run(ByTask);

        first.FromCache.Should().BeFalse();
        second.FromCache.Should().BeTrue();
        second.FetchedAt.Should().Be(first.FetchedAt);
        _runs.Should().Be(1);
    }

    [Fact]
    public async Task Refresh_reads_the_dataset_and_the_rows_again_and_keeps_the_new_rows()
    {
        var first = await Run(ByTask);
        var refreshed = await Run(ByTask with { Refresh = true });
        var after = await Run(ByTask);

        refreshed.FromCache.Should().BeFalse();
        refreshed.FetchedAt.Should().BeAfter(first.FetchedAt);
        after.FromCache.Should().BeTrue();
        after.FetchedAt.Should().Be(refreshed.FetchedAt);
        _runs.Should().Be(2);
        _repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task The_dataset_is_read_once_for_different_questions()
    {
        await Run(ByTask);
        await Run(ByCrew);

        _runs.Should().Be(2);
        _repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Users_with_different_plants_never_share_rows()
    {
        await Run(ByTask, User(admin: false, 10));
        var otherPlant = await Run(ByTask, User(admin: false, 20));
        var samePlant = await Run(ByTask, User(admin: false, 10));

        otherPlant.FromCache.Should().BeFalse();
        samePlant.FromCache.Should().BeTrue();
        _runs.Should().Be(2);
    }

    [Fact]
    public async Task Totals_for_one_plant_are_never_served_to_another_or_as_detail_rows()
    {
        var totals = ByCrew with { Totals = true };
        await Run(totals, User(admin: false, 10));
        var otherPlant = await Run(totals, User(admin: false, 20));
        var detail = await Run(ByCrew, User(admin: false, 10));
        var again = await Run(totals, User(admin: false, 10));

        otherPlant.FromCache.Should().BeFalse();
        detail.FromCache.Should().BeFalse();
        again.FromCache.Should().BeTrue();
        _runs.Should().Be(3);
    }

    [Fact]
    public async Task Detail_rows_are_never_served_as_totals()
    {
        await Run(ByCrew, User(admin: false, 10));
        var totals = await Run(ByCrew with { Totals = true }, User(admin: false, 10));

        totals.FromCache.Should().BeFalse();
        _runs.Should().Be(2);
    }

    [Fact]
    public async Task A_change_to_the_dataset_makes_the_next_question_read_everything_again()
    {
        await Run(ByTask);
        _cache.Changed(TenantId, 1);
        var after = await Run(ByTask);

        after.FromCache.Should().BeFalse();
        _runs.Should().Be(2);
        _repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task A_connection_change_makes_the_next_question_read_everything_again()
    {
        await Run(ByTask);
        _cache.ConnectionsChanged(TenantId);
        var after = await Run(ByTask);

        after.FromCache.Should().BeFalse();
        _runs.Should().Be(2);
        _repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task Refusals_and_failures_are_not_cached()
    {
        var unknownField = () => Run(ByTask with { Dimensions = ["TaskDaily.no_such_column"] });
        await unknownField.Should().ThrowAsync<QueryException>().Where(e => e.Code == QueryErrors.UnknownField);
        _runs.Should().Be(0);

        var answer = _answer;
        _answer = () => throw new QueryException(QueryErrors.Busy, "Too many queries are running. Try again in a moment.");
        var busy = () => Run(ByTask);
        await busy.Should().ThrowAsync<QueryException>().Where(e => e.Code == QueryErrors.Busy);

        _answer = answer;
        var retried = await Run(ByTask);

        retried.FromCache.Should().BeFalse();
        _runs.Should().Be(2);
    }

    [Fact]
    public async Task A_dataset_that_does_not_exist_is_refused_every_time()
    {
        var missing = () => Run(ByTask with { DatasetId = 99 });

        await missing.Should().ThrowAsync<QueryException>().Where(e => e.Code == QueryErrors.UnknownDataset);
        await missing.Should().ThrowAsync<QueryException>().Where(e => e.Code == QueryErrors.UnknownDataset);

        _repo.Verify(r => r.GetSnapshotAsync(99, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
        _runs.Should().Be(0);
    }

    [Fact]
    public async Task A_question_that_reads_today_is_never_answered_from_the_cache()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount),
            Calculated(20, "This month", new FunctionNode("month_start", [new FunctionNode("today", [])]))));
        var handler = new RunModelQueryHandler(repo.Object, _runner.Object, _cache, User(admin: true), Mock.Of<IViewRunRecorder>());
        var byMonth = new RunModelQueryCommand(new QueryRequest(1, ["TaskDaily.This month"], ["Task Count"]), TenantId);

        await handler.Handle(byMonth, default);
        var second = await handler.Handle(byMonth, default);

        second.FromCache.Should().BeFalse();
        _runs.Should().Be(2);
    }

    [Theory]
    [InlineData("SELECT CAST(GETDATE() AS date)", true)]
    [InlineData("SELECT CAST(sysdatetime() AS date)", true)]
    [InlineData("SELECT 1 WHERE x < CURRENT_TIMESTAMP", true)]
    [InlineData("SELECT GETUTCDATE()", true)]
    [InlineData("SELECT [getdate_col] FROM t", false)]
    [InlineData("SELECT 1", false)]
    public void Only_sql_that_reads_the_clock_is_kept_out_of_the_cache(string sql, bool readsClock)
        => RunModelQueryHandler.ReadsClock(sql).Should().Be(readsClock);

    [Fact]
    public async Task A_top_filter_keeps_the_values_the_measure_ranks_first()
    {
        var compiled = new List<CompiledQuery>();
        _runner.Setup(r => r.RunAsync(It.IsAny<CompiledQuery>(), It.IsAny<DatabaseConnection>(), TenantId, It.IsAny<CancellationToken>()))
            .Callback<CompiledQuery, DatabaseConnection, long, CancellationToken>((query, _, _, _) => compiled.Add(query))
            .ReturnsAsync(() => compiled.Count == 1
                ? new QueryResult(["CrewType.code", "Task Count"], [new() { ["CrewType.code"] = "A", ["Task Count"] = 9 }, new() { ["CrewType.code"] = "B", ["Task Count"] = 7 }])
                : new QueryResult(["TaskDaily.task_code", "Task Count"], []));

        await Run(ByTask with { Filters = [new QueryFilter("CrewType.code", "top", ["2", "Task Count"])] });

        compiled.Should().HaveCount(2);
        compiled[0].Sql.Should().Contain("ORDER BY").And.Contain("DESC");
        compiled[1].Sql.Should().Contain("IN (");
        compiled[1].Parameters.Values.Should().Contain("A").And.Contain("B");
    }

    [Fact]
    public async Task A_top_filter_can_rank_by_the_sum_of_a_numeric_field()
    {
        var compiled = new List<CompiledQuery>();
        _runner.Setup(r => r.RunAsync(It.IsAny<CompiledQuery>(), It.IsAny<DatabaseConnection>(), TenantId, It.IsAny<CancellationToken>()))
            .Callback<CompiledQuery, DatabaseConnection, long, CancellationToken>((query, _, _, _) => compiled.Add(query))
            .ReturnsAsync(() => compiled.Count == 1
                ? new QueryResult(["CrewType.code", "Top N value"], [new() { ["CrewType.code"] = "A", ["Top N value"] = 40 }])
                : new QueryResult(["TaskDaily.task_code", "Task Count"], []));

        await Run(ByTask with { Filters = [new QueryFilter("CrewType.code", "bottom", ["1", "CrewType.crew_type_id", "sum"])] });

        compiled.Should().HaveCount(2);
        compiled[0].Sql.Should().Contain("SUM(").And.Contain("ORDER BY").And.NotContain("DESC");
        compiled[1].Parameters.Values.Should().Contain("A");
    }

    private Task<QueryResult> Run(QueryRequest request, ICurrentUserService? user = null)
        => new RunModelQueryHandler(_repo.Object, _runner.Object, _cache, user ?? User(admin: true), Mock.Of<IViewRunRecorder>())
            .Handle(new RunModelQueryCommand(request, TenantId), default);

    private static ICurrentUserService User(bool admin, params int[] plants)
    {
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.Roles).Returns(admin ? new[] { "admin" } : new[] { "planner" });
        user.Setup(u => u.PlantCodes).Returns(plants);
        return user.Object;
    }
}
