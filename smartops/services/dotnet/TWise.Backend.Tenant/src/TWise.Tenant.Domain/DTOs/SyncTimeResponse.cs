namespace TWise.Tenant.Domain.DTOs;

/// <summary>The latest successful migration sync time in Oman (UTC+04:00).</summary>
public sealed record SyncTimeResponse(DateTimeOffset OmanTimestamp);
