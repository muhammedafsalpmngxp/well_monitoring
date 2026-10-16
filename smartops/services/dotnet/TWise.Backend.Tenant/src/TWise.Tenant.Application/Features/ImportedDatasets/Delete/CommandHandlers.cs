using MediatR;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Application.Features.ImportedDatasets;

public sealed class DeleteImportedDatasetHandler(IImportedDatasetService svc)
    : IRequestHandler<DeleteImportedDatasetCommand, bool>
{
    public Task<bool> Handle(DeleteImportedDatasetCommand request, CancellationToken ct)
        => svc.DeleteAsync(request.Id, request.UserId, request.TenantId, ct);
}
