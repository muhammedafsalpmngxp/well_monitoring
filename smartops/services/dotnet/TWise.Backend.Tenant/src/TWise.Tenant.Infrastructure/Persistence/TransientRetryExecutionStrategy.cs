using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace TWise.Tenant.Infrastructure.Persistence;

/// <summary>
/// Retries a query or save that hit a transient SQL Server failure (a dropped connection, a deadlock, Azure SQL
/// throttling: SqlServerRetryingExecutionStrategy's list) up to MaxRetries times, outside transactions.
/// <para>
/// EF's own EnableRetryOnFailure refuses every transaction the code opens itself (BeginTransactionAsync) unless it is
/// wrapped in CreateExecutionStrategy().ExecuteAsync. Several stores open their own transactions on purpose, so here a
/// statement inside such a transaction behaves exactly as before: no retry (a retried statement could not undo the
/// rest of the transaction) and no exception. Code that does wrap its transaction in ExecuteAsync is retried whole.
/// </para>
/// </summary>
public sealed class TransientRetryExecutionStrategy(ExecutionStrategyDependencies dependencies)
    : SqlServerRetryingExecutionStrategy(dependencies, MaxRetries, MaxDelay, errorNumbersToAdd: null)
{
    public const int MaxRetries = 3;
    public static readonly TimeSpan MaxDelay = TimeSpan.FromSeconds(5);

    private bool InUserTransaction =>
        Dependencies.CurrentContext.Context.Database.CurrentTransaction is not null
        || System.Transactions.Transaction.Current is not null;

    protected override void OnFirstExecution()
    {
        // Inside a transaction the code opened: run once, as without a retrying strategy (base would throw here).
        if (InUserTransaction)
        {
            ExceptionsEncountered.Clear();
            return;
        }
        base.OnFirstExecution();
    }

    protected override bool ShouldRetryOn(Exception exception) => !InUserTransaction && base.ShouldRetryOn(exception);
}
