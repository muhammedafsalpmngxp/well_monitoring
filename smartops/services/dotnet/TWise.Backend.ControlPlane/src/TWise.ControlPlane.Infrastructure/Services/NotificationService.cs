using Microsoft.EntityFrameworkCore;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class NotificationService(ControlPlaneDbContext db) : INotificationService
{
    private const int MaxItems = 20;

    public async Task CreateAsync(long tenantId, string type, string title, string? description, string? route,
        IReadOnlyList<long> recipientUserIds, string? moduleCode, CancellationToken ct)
    {
        var recipients = recipientUserIds;
        if (recipients.Count == 0 && !string.IsNullOrWhiteSpace(moduleCode))
            recipients = await ResolveModuleViewersAsync(tenantId, moduleCode, ct);

        if (recipients.Count == 0) return;

        var notification = new Notification
        {
            TenantId = tenantId,
            Type = type,
            Title = title,
            Description = description,
            Route = route,
            CreatedAt = DateTime.UtcNow,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync(ct);

        foreach (var userId in recipients.Distinct())
        {
            db.NotificationRecipients.Add(new NotificationRecipient
            {
                NotificationId = notification.NotificationId,
                TenantId = tenantId,
                UserId = userId.ToString(),
                IsRead = false,
                CreatedAt = DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Every active user in this tenant whose role has CanView on <paramref name="moduleCode"/>.</summary>
    private async Task<List<long>> ResolveModuleViewersAsync(long tenantId, string moduleCode, CancellationToken ct)
    {
        return await (
            from utr in db.Set<UserTenantRole>().AsNoTracking()
            join rp in db.Set<RoleModulePermissions>().AsNoTracking() on utr.RoleId equals rp.RoleId
            join m in db.Set<FeatureModule>().AsNoTracking() on rp.ModuleId equals m.ModuleId
            where utr.TenantId == tenantId && utr.IsActive && rp.IsActive && rp.CanView
                  && m.ModuleCode == moduleCode
            select utr.UserId
        ).Distinct().ToListAsync(ct);
    }

    public async Task<NotificationsResponse> GetForUserAsync(long tenantId, long userId, DateTime since, CancellationToken ct)
    {
        var userIdStr = userId.ToString();

        // Only UNREAD items — once a notification is marked read it disappears from the bell
        // list entirely (not just the badge count), so the panel only ever shows what's pending.
        var query =
            from r in db.NotificationRecipients.AsNoTracking()
            join n in db.Notifications.AsNoTracking() on r.NotificationId equals n.NotificationId
            where r.TenantId == tenantId && r.UserId == userIdStr && !r.IsRead && n.CreatedAt > since
            orderby n.CreatedAt descending
            select new { r.Id, n.NotificationId, n.Type, n.Title, n.Description, n.CreatedAt, r.IsRead, n.Route };

        var rows = await query.Take(MaxItems).ToListAsync(ct);

        var unreadCount = await (
            from r in db.NotificationRecipients.AsNoTracking()
            where r.TenantId == tenantId && r.UserId == userIdStr && !r.IsRead
            select r.Id).CountAsync(ct);

        var items = rows
            .Select(x => new NotificationEntry(x.NotificationId, x.Type, x.Title, x.Description,
                DateTime.SpecifyKind(x.CreatedAt, DateTimeKind.Utc), x.IsRead, x.Route))
            .ToList();

        return new NotificationsResponse(unreadCount, items);
    }

    public async Task<bool> MarkAsReadAsync(long tenantId, long userId, long notificationId, CancellationToken ct)
    {
        var userIdStr = userId.ToString();
        var recipient = await db.NotificationRecipients
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.UserId == userIdStr && r.NotificationId == notificationId, ct);
        if (recipient is null) return false;

        if (!recipient.IsRead)
        {
            recipient.IsRead = true;
            recipient.ReadAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return true;
    }

    public async Task MarkAllAsReadAsync(long tenantId, long userId, CancellationToken ct)
    {
        var userIdStr = userId.ToString();
        var now = DateTime.UtcNow;
        await db.NotificationRecipients
            .Where(r => r.TenantId == tenantId && r.UserId == userIdStr && !r.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.IsRead, true).SetProperty(r => r.ReadAt, now), ct);
    }
}
