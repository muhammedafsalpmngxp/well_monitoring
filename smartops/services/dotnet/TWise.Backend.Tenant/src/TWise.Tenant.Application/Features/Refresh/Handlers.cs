using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Refresh;

// Thin handlers — behaviour lives in IRefreshService, matching the other features.

public sealed class ListRefreshSchedulesHandler(IRefreshService svc)
    : IRequestHandler<ListRefreshSchedulesQuery, IReadOnlyList<RefreshScheduleDto>>
{
    public Task<IReadOnlyList<RefreshScheduleDto>> Handle(ListRefreshSchedulesQuery request, CancellationToken cancellationToken)
        => svc.GetSchedulesAsync(request.TenantId, cancellationToken);
}

public sealed class GetRefreshScheduleHandler(IRefreshService svc)
    : IRequestHandler<GetRefreshScheduleQuery, RefreshScheduleDto?>
{
    public Task<RefreshScheduleDto?> Handle(GetRefreshScheduleQuery request, CancellationToken cancellationToken)
        => svc.GetScheduleAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class ListRefreshJobsHandler(IRefreshService svc)
    : IRequestHandler<ListRefreshJobsQuery, IReadOnlyList<RefreshJobDto>>
{
    public Task<IReadOnlyList<RefreshJobDto>> Handle(ListRefreshJobsQuery request, CancellationToken cancellationToken)
        => svc.GetJobsAsync(request.TenantId, request.Limit, cancellationToken);
}

public sealed class ListDatasetRefreshStatusHandler(IRefreshService svc)
    : IRequestHandler<ListDatasetRefreshStatusQuery, IReadOnlyList<DatasetRefreshStatusDto>>
{
    public Task<IReadOnlyList<DatasetRefreshStatusDto>> Handle(ListDatasetRefreshStatusQuery request, CancellationToken cancellationToken)
        => svc.GetDatasetStatusesAsync(request.TenantId, cancellationToken);
}

public sealed class PreviewCronHandler(IRefreshService svc)
    : IRequestHandler<PreviewCronQuery, CronPreviewResponse>
{
    public Task<CronPreviewResponse> Handle(PreviewCronQuery request, CancellationToken cancellationToken)
        => Task.FromResult(svc.PreviewCron(request.CronExpression, request.TimeZoneId, request.Count));
}

public sealed class CreateRefreshScheduleHandler(IRefreshService svc)
    : IRequestHandler<CreateRefreshScheduleCommand, RefreshScheduleDto>
{
    public Task<RefreshScheduleDto> Handle(CreateRefreshScheduleCommand request, CancellationToken cancellationToken)
        => svc.CreateScheduleAsync(request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class UpdateRefreshScheduleHandler(IRefreshService svc)
    : IRequestHandler<UpdateRefreshScheduleCommand, RefreshScheduleDto?>
{
    public Task<RefreshScheduleDto?> Handle(UpdateRefreshScheduleCommand request, CancellationToken cancellationToken)
        => svc.UpdateScheduleAsync(request.Id, request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class DeleteRefreshScheduleHandler(IRefreshService svc)
    : IRequestHandler<DeleteRefreshScheduleCommand, bool>
{
    public Task<bool> Handle(DeleteRefreshScheduleCommand request, CancellationToken cancellationToken)
        => svc.DeleteScheduleAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class RunRefreshScheduleHandler(IRefreshService svc)
    : IRequestHandler<RunRefreshScheduleCommand, RefreshJobDto?>
{
    public Task<RefreshJobDto?> Handle(RunRefreshScheduleCommand request, CancellationToken cancellationToken)
        => svc.RunScheduleNowAsync(request.ScheduleId, request.UserId, request.TenantId, cancellationToken);
}

public sealed class RunManualRefreshHandler(IRefreshService svc)
    : IRequestHandler<RunManualRefreshCommand, RefreshJobDto>
{
    public Task<RefreshJobDto> Handle(RunManualRefreshCommand request, CancellationToken cancellationToken)
        => svc.RunManualAsync(request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class RetryRefreshJobHandler(IRefreshService svc)
    : IRequestHandler<RetryRefreshJobCommand, RefreshJobDto?>
{
    public Task<RefreshJobDto?> Handle(RetryRefreshJobCommand request, CancellationToken cancellationToken)
        => svc.RetryJobAsync(request.JobId, request.UserId, request.TenantId, cancellationToken);
}
