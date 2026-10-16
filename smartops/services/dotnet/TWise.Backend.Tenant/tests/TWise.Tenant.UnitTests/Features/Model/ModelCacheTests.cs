using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Query;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ModelCacheTests
{
    private static readonly CompiledQuery Compiled = new(
        "SELECT TOP (@top) [t0].[task_code] FROM [core].[TaskDaily] AS [t0]",
        new Dictionary<string, object> { ["@top"] = 5000 }, ["TaskDaily.task_code"]);

    [Fact]
    public async Task A_snapshot_is_read_once_until_its_dataset_changes()
    {
        var cache = NewCache();
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var first = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);
        var second = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);
        cache.Changed(TenantId, 1);
        var third = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);

        second.Should().BeSameAs(first);
        first!.Version.Should().Be(0);
        third!.Version.Should().Be(1);
        repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task A_connection_change_makes_the_next_read_of_every_dataset_of_the_tenant_miss()
    {
        var cache = NewCache();
        var repo = Repo(NewDataset(), Parts(Tasks()));
        var before = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);
        var key = ResultKey.For(TenantId, before!, new UserScope(true, []), Compiled);
        cache.SetResult(key, Result(3));

        cache.ConnectionsChanged(TenantId);
        var after = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);

        after.Should().NotBeSameAs(before);
        repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
        cache.Result(ResultKey.For(TenantId, after!, new UserScope(true, []), Compiled)).Should().BeNull();
    }

    [Fact]
    public void A_change_for_one_tenant_leaves_another_tenants_versions_alone()
    {
        var cache = NewCache();

        cache.Changed(3, 1);
        cache.ConnectionsChanged(3);

        cache.Version(TenantId, 1).Should().Be(0);
        cache.Generation(TenantId).Should().Be(0);
        cache.Version(3, 1).Should().Be(1);
        cache.Generation(3).Should().Be(1);
    }

    [Fact]
    public async Task A_snapshot_kept_for_one_tenant_is_not_served_to_another_with_the_same_dataset_id()
    {
        var cache = NewCache();
        var repo = Repo(NewDataset(), Parts(Tasks()));

        await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);
        var other = await cache.SnapshotAsync(repo.Object, 1, 3, reload: false, default);

        other.Should().BeNull();
        repo.Verify(r => r.GetSnapshotAsync(1, 3, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_snapshot_read_while_its_dataset_changes_is_not_served_at_the_new_version()
    {
        var cache = NewCache();
        var pending = new TaskCompletionSource<ModelSnapshot?>();
        var repo = new Mock<IDatasetRepository>();
        repo.SetupSequence(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()))
            .Returns(pending.Task)
            .ReturnsAsync(Snapshot(Parts(Tasks())));

        var reading = cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);
        cache.Changed(TenantId, 1);
        pending.SetResult(Snapshot(Parts(Tasks())));
        var stale = await reading;
        var fresh = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);

        stale!.Version.Should().Be(0);
        fresh!.Version.Should().Be(1);
        fresh.Should().NotBeSameAs(stale);
        repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task Reload_reads_the_snapshot_again_and_keeps_the_new_one()
    {
        var cache = NewCache();
        var repo = Repo(NewDataset(), Parts(Tasks()));

        await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);
        var reloaded = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: true, default);
        var after = await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default);

        after.Should().BeSameAs(reloaded);
        repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task A_dataset_that_is_not_found_is_not_cached()
    {
        var cache = NewCache();
        var repo = new Mock<IDatasetRepository>();

        (await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default)).Should().BeNull();
        (await cache.SnapshotAsync(repo.Object, 1, TenantId, reload: false, default)).Should().BeNull();

        repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public void A_result_is_found_only_under_the_version_it_was_stored_at()
    {
        var cache = NewCache();
        var admin = new UserScope(true, []);
        var key = ResultKey.For(TenantId, Snapshot(Parts(Tasks())), admin, Compiled);
        var result = Result(3);

        cache.SetResult(key, result);

        cache.Result(key).Should().BeSameAs(result);
        cache.Result(key with { Version = 1 }).Should().BeNull();
        cache.Result(key with { TenantId = 3 }).Should().BeNull();
        cache.Result(key with { Generation = 1 }).Should().BeNull();
    }

    [Fact]
    public void Results_are_shared_only_between_users_with_the_same_row_scope()
    {
        var snapshot = Snapshot(Parts(Tasks()));
        ResultKey Key(bool admin, params int[] plants) => ResultKey.For(TenantId, snapshot, new UserScope(admin, plants), Compiled);

        Key(false, 20, 10, 10).Should().Be(Key(false, 10, 20));
        Key(false, 10).Should().NotBe(Key(false, 10, 20));
        Key(false).Should().NotBe(Key(true));
        Key(true, 10).Should().NotBe(Key(false, 10));
    }

    [Fact]
    public async Task A_result_is_dropped_after_the_lifetime()
    {
        var cache = new ModelCache(TimeSpan.FromMilliseconds(20), 200_000);
        var key = ResultKey.For(TenantId, Snapshot(Parts(Tasks())), new UserScope(true, []), Compiled);
        cache.SetResult(key, Result(1));

        await Task.Delay(200);

        cache.Result(key).Should().BeNull();
    }

    [Fact]
    public void A_result_larger_than_the_size_limit_is_not_kept()
    {
        var cache = new ModelCache(TimeSpan.FromMinutes(10), 10);
        var key = ResultKey.For(TenantId, Snapshot(Parts(Tasks())), new UserScope(true, []), Compiled);

        cache.SetResult(key, Result(20));

        cache.Result(key).Should().BeNull();
    }

    private static QueryResult Result(int rows) => new(
        ["TaskDaily.task_code"],
        Enumerable.Range(0, rows).Select(i => new Dictionary<string, object?> { ["TaskDaily.task_code"] = $"T{i}" }).ToList(),
        DateTime.UtcNow);
}
