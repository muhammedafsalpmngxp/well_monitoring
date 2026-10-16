using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ViewDescriptionCacheTests
{
    private readonly MemoryCache _cache = new(new MemoryCacheOptions());
    private int _described;

    private Task<IReadOnlyList<ViewColumn>> Describe(IReadOnlyList<ViewColumn> columns)
    {
        _described++;
        return Task.FromResult(columns);
    }

    [Fact]
    public async Task A_description_is_kept_in_the_memory_cache_per_connection_and_sql()
    {
        IReadOnlyList<ViewColumn> columns = [new ViewColumn("Id", "int")];

        (await ViewSources.CachedAsync(_cache, 4, "SELECT 1 AS Id", () => Describe(columns))).Should().BeSameAs(columns);
        (await ViewSources.CachedAsync(_cache, 4, "SELECT 1 AS Id", () => Describe(columns))).Should().BeSameAs(columns);
        await ViewSources.CachedAsync(_cache, 5, "SELECT 1 AS Id", () => Describe(columns));

        _described.Should().Be(2);
        _cache.Count.Should().Be(2);
    }

    [Fact]
    public async Task A_view_that_could_not_be_described_is_not_kept()
    {
        await ViewSources.CachedAsync(_cache, 4, "SELECT x", () => Describe([]));
        await ViewSources.CachedAsync(_cache, 4, "SELECT x", () => Describe([]));

        _described.Should().Be(2);
        _cache.Count.Should().Be(0);
    }
}
