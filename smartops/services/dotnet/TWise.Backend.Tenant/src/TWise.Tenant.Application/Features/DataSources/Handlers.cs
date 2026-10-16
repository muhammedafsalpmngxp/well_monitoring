using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataSources;

// Thin handlers — the behaviour lives in IDataSourceConnectionService, matching the
// DatabaseConnections feature. Keeping them one-liners makes the pipeline easy to follow
// when tracing a request in the logs.

public sealed class ListDataSourcesHandler(IDataSourceConnectionService svc)
    : IRequestHandler<ListDataSourcesQuery, IReadOnlyList<DataSourceConnectionDto>>
{
    public Task<IReadOnlyList<DataSourceConnectionDto>> Handle(ListDataSourcesQuery request, CancellationToken cancellationToken)
        => svc.GetAllAsync(request.TenantId, cancellationToken);
}

public sealed class GetDataSourceHandler(IDataSourceConnectionService svc)
    : IRequestHandler<GetDataSourceQuery, DataSourceConnectionDto?>
{
    public Task<DataSourceConnectionDto?> Handle(GetDataSourceQuery request, CancellationToken cancellationToken)
        => svc.GetByIdAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class ListDataSourceObjectsHandler(IDataSourceConnectionService svc)
    : IRequestHandler<ListDataSourceObjectsQuery, IReadOnlyList<DataSourceObjectDto>?>
{
    public Task<IReadOnlyList<DataSourceObjectDto>?> Handle(ListDataSourceObjectsQuery request, CancellationToken cancellationToken)
        => svc.ListObjectsAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class GetDataSourceOptionsHandler(IDataSourceConnectionService svc)
    : IRequestHandler<GetDataSourceOptionsQuery, DataSourceOptionsResponse>
{
    public Task<DataSourceOptionsResponse> Handle(GetDataSourceOptionsQuery request, CancellationToken cancellationToken)
        => Task.FromResult(svc.GetOptions());
}

public sealed class CreateDataSourceHandler(IDataSourceConnectionService svc)
    : IRequestHandler<CreateDataSourceCommand, DataSourceConnectionDto>
{
    public Task<DataSourceConnectionDto> Handle(CreateDataSourceCommand request, CancellationToken cancellationToken)
        => svc.CreateAsync(request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class UpdateDataSourceHandler(IDataSourceConnectionService svc)
    : IRequestHandler<UpdateDataSourceCommand, DataSourceConnectionDto?>
{
    public Task<DataSourceConnectionDto?> Handle(UpdateDataSourceCommand request, CancellationToken cancellationToken)
        => svc.UpdateAsync(request.Id, request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class DeleteDataSourceHandler(IDataSourceConnectionService svc)
    : IRequestHandler<DeleteDataSourceCommand, bool>
{
    public Task<bool> Handle(DeleteDataSourceCommand request, CancellationToken cancellationToken)
        => svc.DeleteAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class TestDataSourceHandler(IDataSourceConnectionService svc)
    : IRequestHandler<TestDataSourceCommand, DataSourceTestResponse?>
{
    public Task<DataSourceTestResponse?> Handle(TestDataSourceCommand request, CancellationToken cancellationToken)
        => svc.TestAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class IngestDataSourceHandler(IDataSourceConnectionService svc)
    : IRequestHandler<IngestDataSourceCommand, ImportedDatasetDto?>
{
    public Task<ImportedDatasetDto?> Handle(IngestDataSourceCommand request, CancellationToken cancellationToken)
        => svc.IngestAsync(request.Id, request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class SaveGoogleTokenHandler(IDataSourceConnectionService svc)
    : IRequestHandler<SaveGoogleTokenCommand, bool>
{
    public Task<bool> Handle(SaveGoogleTokenCommand request, CancellationToken cancellationToken)
        => svc.SaveGoogleRefreshTokenAsync(request.Id, request.RefreshToken, request.UserId, request.TenantId, cancellationToken);
}
