using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ImportedDatasets;

public sealed class ListImportedDatasetsHandler(IImportedDatasetService svc)
    : IRequestHandler<ListImportedDatasetsQuery, IReadOnlyList<ImportedDatasetListDto>>
{
    public Task<IReadOnlyList<ImportedDatasetListDto>> Handle(ListImportedDatasetsQuery request, CancellationToken ct)
        => svc.GetAllAsync(request.TenantId, request.UserId, ct);
}

public sealed class GetImportedDatasetByIdHandler(IImportedDatasetService svc)
    : IRequestHandler<GetImportedDatasetByIdQuery, ImportedDatasetDto?>
{
    public Task<ImportedDatasetDto?> Handle(GetImportedDatasetByIdQuery request, CancellationToken ct)
        => svc.GetByIdAsync(request.Id, request.TenantId, ct);
}

public sealed class GetImportedDatasetDataHandler(IImportedDatasetService svc)
    : IRequestHandler<GetImportedDatasetDataQuery, ImportedDatasetDataResponse?>
{
    public Task<ImportedDatasetDataResponse?> Handle(GetImportedDatasetDataQuery request, CancellationToken ct)
        => svc.GetDataAsync(request.Id, request.TenantId, ct);
}
