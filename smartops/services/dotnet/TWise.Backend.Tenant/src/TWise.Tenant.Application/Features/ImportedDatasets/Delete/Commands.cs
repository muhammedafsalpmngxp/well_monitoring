using MediatR;

namespace TWise.Tenant.Application.Features.ImportedDatasets;

public record DeleteImportedDatasetCommand(long Id, long UserId, long TenantId) : IRequest<bool>;
