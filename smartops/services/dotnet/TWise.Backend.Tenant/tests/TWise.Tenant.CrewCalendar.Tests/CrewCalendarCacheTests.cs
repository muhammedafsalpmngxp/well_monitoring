using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Infrastructure.Services.Legacy;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public sealed class CrewCalendarCacheTests
{
    [Fact]
    public void LatestSnapshotResourcePreservesTheUnfilteredRosterScope()
    {
        var sql = ReadSql("crew-latest-rows.sql");
        Assert.Contains("PARTITION BY project_id, code, Well_ID", sql);
        Assert.Contains("ORDER BY updated_at DESC, schedule_id DESC, row_id DESC", sql);
        Assert.DoesNotContain("Well_ID IS NOT NULL", sql);
        Assert.DoesNotContain("@fromDate", sql);
        Assert.DoesNotContain("@toDate", sql);
    }

    [Theory]
    [InlineData("crew-calendar.sql")]
    [InlineData("crew-roster.sql")]
    public void QueryResourcesKeepStandaloneAndSharedSnapshotPaths(string resource)
    {
        var sql = ReadSql(resource);
        Assert.Contains("/* __SHARED_LATEST_ROWS__ */", sql);
        Assert.Contains("OPENJSON(@sharedLatestRows)", sql);
        Assert.Contains("WHERE RowRank = 1", sql);
    }

    private static string ReadSql(string suffix)
    {
        var assembly = typeof(LegacyCrewCalendarService).Assembly;
        var resource = Assert.Single(assembly.GetManifestResourceNames(), name => name.EndsWith(suffix, StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    [Fact]
    public async Task ConcurrentRequestsAcrossServiceInstancesShareOneLoad()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        Task<string> Load(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref calls);
            return completion.Task.WaitAsync(cancellationToken);
        }

        var first = new CrewCalendarCache(memory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), Load, default);
        var second = new CrewCalendarCache(memory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), Load, default);
        completion.SetResult("result");

        Assert.Equal(new[] { "result", "result" }, await Task.WhenAll(first, second));
        Assert.Equal(1, calls);
        Assert.Equal("result", await new CrewCalendarCache(memory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), Load, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task CancelledWaiterDoesNotCancelTheSharedLoad()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        using var cancellation = new CancellationTokenSource();
        var coordinator = new CrewCalendarCache(memory);
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => completion.Task, default);
        var waiter = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("unexpected"), cancellation.Token);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiter);
        completion.SetResult("result");
        Assert.Equal("result", await first);
    }

    [Fact]
    public async Task SurvivingWaiterRetriesWhenTheOriginalLoaderIsCancelled()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        using var cancellation = new CancellationTokenSource();
        var coordinator = new CrewCalendarCache(memory);
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), token => completion.Task.WaitAsync(token), cancellation.Token);
        var waiter = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("recovered"), default);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        Assert.Equal("recovered", await waiter);
    }

    [Fact]
    public async Task FailedLoadsAreNotCachedAndCanBeRetried()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(memory);
        await Assert.ThrowsAsync<InvalidOperationException>(() => coordinator.GetOrCreateAsync<string>(
            "calendar", TimeSpan.FromMinutes(5), _ => Task.FromException<string>(new InvalidOperationException()), default));
        Assert.Equal("recovered", await coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("recovered"), default));
    }

    [Fact]
    public async Task LoaderCancellationWithoutCallerCancellationIsNotRetriedForever()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(memory);
        var calls = 0;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => coordinator.GetOrCreateAsync<string>(
            "calendar", TimeSpan.FromMinutes(5), _ =>
            {
                calls++;
                return Task.FromCanceled<string>(new CancellationToken(true));
            }, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task DependentResultDoesNotOutliveItsSnapshot()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(memory);
        var result = await coordinator.GetOrCreateAsync("roster", TimeSpan.FromMinutes(5),
            _ => Task.FromResult("result"), default, _ => DateTimeOffset.UtcNow.AddSeconds(-1));
        Assert.Equal("result", result);
        Assert.False(memory.TryGetValue("roster", out _));
    }

    [Fact]
    public async Task DifferentScopesAndMemoryCachesRemainIndependent()
    {
        using var firstMemory = new MemoryCache(new MemoryCacheOptions());
        using var secondMemory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(firstMemory);
        Assert.Equal("first", await coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("first"), default));
        Assert.Equal("other scope", await coordinator.GetOrCreateAsync("roster", TimeSpan.FromMinutes(5), _ => Task.FromResult("other scope"), default));
        Assert.Equal("other database", await new CrewCalendarCache(secondMemory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("other database"), default));
    }
}