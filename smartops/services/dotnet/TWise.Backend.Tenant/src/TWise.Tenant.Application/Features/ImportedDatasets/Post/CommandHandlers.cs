using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.ImportedDatasets;

public sealed class ImportDatasetHandler(IImportedDatasetService svc)
    : IRequestHandler<ImportDatasetCommand, ImportedDatasetDto>
{
    public Task<ImportedDatasetDto> Handle(ImportDatasetCommand request, CancellationToken ct)
        => svc.ImportAsync(request.FileStream, request.FileName, request.DatasetName, request.UserId, request.TenantId, ct);
}
