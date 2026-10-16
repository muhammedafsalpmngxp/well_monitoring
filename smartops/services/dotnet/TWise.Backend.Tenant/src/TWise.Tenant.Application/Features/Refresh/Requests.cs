using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Refresh;

// ── Queries ─────────────────────────────────────────────────────────────────

public record ListRefreshSchedulesQuery(long TenantId) : IRequest<IReadOnlyList<RefreshScheduleDto>>;

public record GetRefreshScheduleQuery(long Id, long TenantId) : IRequest<RefreshScheduleDto?>;

public record ListRefreshJobsQuery(long TenantId, int Limit) : IRequest<IReadOnlyList<RefreshJobDto>>;

public record ListDatasetRefreshStatusQuery(long TenantId) : IRequest<IReadOnlyList<DatasetRefreshStatusDto>>;

public record PreviewCronQuery(string CronExpression, string TimeZoneId, int Count) : IRequest<CronPreviewResponse>;

// ── Commands ────────────────────────────────────────────────────────────────

public record CreateRefreshScheduleCommand(CreateRefreshScheduleRequest Request, long UserId, long TenantId)
    : IRequest<RefreshScheduleDto>;

public record UpdateRefreshScheduleCommand(long Id, UpdateRefreshScheduleRequest Request, long UserId, long TenantId)
    : IRequest<RefreshScheduleDto?>;

public record DeleteRefreshScheduleCommand(long Id, long TenantId) : IRequest<bool>;

/// <summary>Runs a schedule immediately without changing its next scheduled fire time.</summary>
public record RunRefreshScheduleCommand(long ScheduleId, long UserId, long TenantId) : IRequest<RefreshJobDto?>;

/// <summary>Runs an ad-hoc refresh not attached to any schedule.</summary>
public record RunManualRefreshCommand(RunRefreshRequest Request, long UserId, long TenantId) : IRequest<RefreshJobDto>;

/// <summary>Re-runs a previous job as a new job, leaving the original in the history.</summary>
public record RetryRefreshJobCommand(long JobId, long UserId, long TenantId) : IRequest<RefreshJobDto?>;
