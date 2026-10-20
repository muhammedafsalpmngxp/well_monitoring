using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.UnitTests.Features.Security;

/// <summary>Transient SQL failures are retried, while the code's own transactions keep working exactly as before.</summary>
public class TransientRetryExecutionStrategyTests
{
    private static TenantDbContext Context(string connectionString) => new(new DbContextOptionsBuilder<TenantDbContext>()
        .UseSqlServer(connectionString, sql => sql.ExecutionStrategy(d => new TransientRetryExecutionStrategy(d))).Options);

    [Fact]
    public void The_tenant_context_retries_transient_failures()
    {
        using var db = Context("Server=localhost;Database=x;Integrated Security=true;TrustServerCertificate=true");
        var strategy = db.Database.CreateExecutionStrategy();
        strategy.Should().BeOfType<TransientRetryExecutionStrategy>();
        strategy.RetriesOnFailure.Should().BeTrue();
    }

    /// <summary>Live check (set TENANT_DB_TEST to a tenant connection string): a transaction the code opens itself
    /// still works under the retrying strategy (EF's EnableRetryOnFailure would throw here). Read-only; rolled back.</summary>
    [Fact]
    public async Task A_transaction_the_code_opens_itself_still_works()
    {
        var cs = Environment.GetEnvironmentVariable("TENANT_DB_TEST");
        if (string.IsNullOrWhiteSpace(cs)) return;
        await using var db = Context(cs);
        await using var tx = await db.Database.BeginTransactionAsync();
        var one = await db.Database.SqlQuery<int>($"SELECT 1 AS Value").ToListAsync();
        one.Should().Equal(1);
        await tx.RollbackAsync();

        // And a plain query outside a transaction runs through the retrying path.
        (await db.Database.SqlQuery<int>($"SELECT 2 AS Value").ToListAsync()).Should().Equal(2);
    }
}
