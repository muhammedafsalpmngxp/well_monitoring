using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ImportedDatasets;

public record ListImportedDatasetsQuery(long TenantId, long UserId) : IRequest<IReadOnlyList<ImportedDatasetListDto>>;
public record GetImportedDatasetByIdQuery(long Id, long TenantId) : IRequest<ImportedDatasetDto?>;
public record GetImportedDatasetDataQuery(long Id, long TenantId) : IRequest<ImportedDatasetDataResponse?>;
