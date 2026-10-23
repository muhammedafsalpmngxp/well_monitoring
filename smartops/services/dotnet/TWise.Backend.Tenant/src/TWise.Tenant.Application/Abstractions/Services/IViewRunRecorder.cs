using System.Diagnostics;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Queues a chart or view load for the run log. Never blocks or throws: when the queue is full the run is dropped.</summary>
public interface IViewRunRecorder
{
    void Record(ViewRun run);
}

public static class ViewRunTiming
{
    /// <summary>Recorded for a load that returned nothing (the source was not found or the request was refused).</summary>
    public const string NoResult = "No data came back: the source was not found or the request was refused.";

    private static readonly AsyncLocal<ViewRun?> Current = new();

    /// <summary>Runs the load and records it with its duration and <paramref name="outcome"/> (rows, error; null: not
    /// recorded), or with the exception's message. A cancelled load is not recorded. The code that runs the query names
    /// its SQL with <see cref="NoteSql"/>.</summary>
    public static async Task<T> TimeAsync<T>(this IViewRunRecorder recorder, ViewRun run, Func<Task<T>> load, Func<T, (int? Rows, string? Error)?> outcome)
    {
        var clock = Stopwatch.StartNew();
        Current.Value = run;
        try
        {
            var result = await load();
            if (outcome(result) is not { } o) return result;
            (run.RowCount, run.Error) = o;
            run.DurationMs = (int)clock.ElapsedMilliseconds;
            recorder.Record(run);
            return result;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A friendly message keeps the database's own error next to it.
            run.Error = ex.InnerException is { } inner && inner.Message != ex.Message ? $"{ex.Message} ({inner.Message})" : ex.Message;
            run.DurationMs = (int)clock.ElapsedMilliseconds;
            recorder.Record(run);
            throw;
        }
    }

    /// <summary>The SQL the load being timed sends to the database (kept for failed and slow runs). No-op outside TimeAsync.</summary>
    public static void NoteSql(string sql)
    {
        if (Current.Value is { } run) run.Sql = sql;
    }

    /// <summary>The signed-in user's id, when it is a number.</summary>
    public static long? UserIdOf(ICurrentUserService user) => long.TryParse(user.UserId, out var id) ? id : null;
}
