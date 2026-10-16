using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace SmartOps.Shared.Db;

/// <summary>Auto-stamps CreatedAt / UpdatedAt on every save.</summary>
public sealed class AuditSaveChangesInterceptor : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var ctx = eventData.Context;
        if (ctx is not null) Stamp(ctx);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        var ctx = eventData.Context;
        if (ctx is not null) Stamp(ctx);
        return base.SavingChanges(eventData, result);
    }

    private static void Stamp(DbContext ctx)
    {
        foreach (EntityEntry<AuditableEntity> e in ctx.ChangeTracker.Entries<AuditableEntity>())
        {
            switch (e.State)
            {
                case EntityState.Added:
                    e.Entity.CreatedAt = DateTime.UtcNow;
                    e.Entity.UpdatedAt = DateTime.UtcNow;
                    break;
                case EntityState.Modified:
                    e.Entity.UpdatedAt = DateTime.UtcNow;
                    break;
            }
        }
    }
}
