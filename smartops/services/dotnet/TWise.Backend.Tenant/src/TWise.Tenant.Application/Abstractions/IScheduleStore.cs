using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>Schedules and their runs. Deleted schedules are left out of every read.</summary>
public interface IScheduleStore
{
    /// <summary>The tenant's schedules with their recipients, newest first, optionally of one item.</summary>
    Task<IReadOnlyList<Schedule>> ListAsync(long tenantId, string? targetType, long? targetId, CancellationToken ct = default);

    /// <summary>Tracked, with its recipients, so SaveAsync writes changes. Any tenant's when tenantId is null (the worker).</summary>
    Task<Schedule?> GetAsync(long id, long? tenantId, CancellationToken ct = default);

    Task AddAsync(Schedule schedule, CancellationToken ct = default);

    Task SaveAsync(CancellationToken ct = default);

    /// <summary>Reads the tracked schedule again from the database, so a run records itself over any edit made meanwhile.</summary>
    Task ReloadAsync(Schedule schedule, CancellationToken ct = default);

    /// <summary>
    /// Takes up to max active schedules due at nowUtc and moves their NextRunAt to leaseUntilUtc in the same statement,
    /// so no other instance takes them and a crash only delays them. Returns their ids.
    /// </summary>
    Task<IReadOnlyList<long>> ClaimDueAsync(DateTime nowUtc, int max, DateTime leaseUntilUtc, CancellationToken ct = default);

    Task AddRunAsync(ScheduleRun run, CancellationToken ct = default);

    /// <summary>A page of the tenant's runs, newest first.</summary>
    Task<(IReadOnlyList<ScheduleRun> Items, int Total)> RunsAsync(
        long tenantId, long? scheduleId, string? status, DateTime? from, DateTime? to, int page, int pageSize, CancellationToken ct = default);

    /// <summary>
    /// The names of the items, by type and id; an item that is missing or deleted is left out, and so is one readerId may
    /// not read (TargetAccess) when a reader is given.
    /// </summary>
    Task<IReadOnlyDictionary<(string Type, long Id), string>> TargetNamesAsync(
        long tenantId, IReadOnlyCollection<(string Type, long Id)> targets, long? readerId = null, CancellationToken ct = default);
}
