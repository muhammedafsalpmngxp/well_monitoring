using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.Application.Features.Model;

/// <summary>
/// Dataset query cache (design decision D-4): each dataset's snapshot and each query result.
/// Every key carries the dataset's version, which DatasetChangeBehavior moves after every change
/// to the dataset, and the tenant's generation, which it moves after every change to a database
/// connection or its catalogue, so nothing stored before a change is read after it. Versions and
/// generations are kept per tenant, so one tenant's changes never move another's. Entries also expire after
/// the lifetime. Size is counted in rows: a result counts its rows, a snapshot its parts and
/// catalogue columns, each plus one. When the limit is reached new entries are not kept.
/// </summary>
// ponytail: memory of one API instance. A second instance neither shares these entries nor hears
// of changes made through another instance, so after an edit it can serve results up to the
// lifetime old. Move to a shared cache (Redis) with a shared version stamp before scaling out.
public sealed class ModelCache(TimeSpan lifetime, long sizeLimit)
{
    private readonly MemoryCache _entries = new(new MemoryCacheOptions { SizeLimit = sizeLimit });
    private readonly ConcurrentDictionary<(long TenantId, long DatasetId), long> _versions = new();
    private readonly ConcurrentDictionary<long, long> _generations = new();

    /// <summary>The dataset's current version: 0 until its first change in this process.</summary>
    public long Version(long tenantId, long datasetId) => _versions.GetValueOrDefault((tenantId, datasetId));

    /// <summary>Moves the dataset to a new version. Called after every change to it, successful or not.</summary>
    public void Changed(long tenantId, long datasetId) => _versions.AddOrUpdate((tenantId, datasetId), 1, (_, version) => version + 1);

    /// <summary>The tenant's current generation: 0 until its first connection change in this process.</summary>
    public long Generation(long tenantId) => _generations.GetValueOrDefault(tenantId);

    /// <summary>
    /// Moves the tenant to a new generation, so no snapshot or result of any of its datasets is
    /// read again. Called after a connection is changed or deleted or its catalogue is synced.
    /// </summary>
    public void ConnectionsChanged(long tenantId) => _generations.AddOrUpdate(tenantId, 1, (_, generation) => generation + 1);

    /// <summary>
    /// The dataset as read at its current version: from memory, or from the repository on a miss
    /// or when reload is set, and then kept. Null, with nothing kept, when the repository does not
    /// find the dataset for this tenant.
    /// </summary>
    public async Task<ModelSnapshot?> SnapshotAsync(
        IDatasetRepository repo, long datasetId, long tenantId, bool reload, CancellationToken ct)
    {
        // The version and generation are taken before the read. A change saved during the read moves
        // them afterwards, so this snapshot, possibly half old, is kept under a key nobody asks for.
        var generation = Generation(tenantId);
        var version = Version(tenantId, datasetId);
        var key = new SnapshotKey(tenantId, datasetId, generation, version);
        if (!reload && _entries.TryGetValue(key, out ModelSnapshot? cached)) return cached;

        if (await repo.GetSnapshotAsync(datasetId, tenantId, ct) is not { } read) return null;
        var snapshot = read with { Version = version, Generation = generation };
        Keep(key, snapshot, 1 + snapshot.Sources.Count + snapshot.Relationships.Count + snapshot.Measures.Count + snapshot.Columns.Count + snapshot.PublishedColumns.Count
            + snapshot.CalculatedColumns.Count + snapshot.Transforms.Count);
        return snapshot;
    }

    /// <summary>The kept result for this key, or null.</summary>
    public QueryResult? Result(ResultKey key) => _entries.TryGetValue(key, out QueryResult? result) ? result : null;

    public void SetResult(ResultKey key, QueryResult result) => Keep(key, result, 1 + result.Rows.Count);

    private void Keep(object key, object value, long size)
        => _entries.Set(key, value, new MemoryCacheEntryOptions { Size = size, AbsoluteExpirationRelativeToNow = lifetime });

    private sealed record SnapshotKey(long TenantId, long DatasetId, long Generation, long Version);
}

/// <summary>
/// What a cached result is found by: the tenant and its generation, the dataset and its version, the user's row
/// scope, and the compiled query. The compiled SQL already carries the row filter and every
/// resolved name; the scope is in the key as well, so rows are never shared between scopes.
/// </summary>
public sealed record ResultKey(long TenantId, long DatasetId, long Generation, long Version, string Scope, string Sql, string Parameters)
{
    public static ResultKey For(long tenantId, ModelSnapshot snapshot, UserScope user, CompiledQuery compiled) => new(
        tenantId,
        snapshot.Dataset.Id,
        snapshot.Generation,
        snapshot.Version,
        $"{(user.IsAdmin ? "admin" : "user")}:{string.Join(',', user.PlantCodes.Distinct().Order())}",
        compiled.Sql,
        // JSON keeps each value's type and a DateTime's full precision, so two different filters never share a key.
        JsonSerializer.Serialize(compiled.Parameters));
}
