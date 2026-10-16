using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ImportedDatasets;

public record ImportDatasetCommand(Stream FileStream, string FileName, string? DatasetName, long UserId, long TenantId)
    : IRequest<ImportedDatasetDto>;
