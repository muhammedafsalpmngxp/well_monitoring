using MediatR;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Model.Imports;

// Every upload goes through a data model on the tenant database (DatasetRules.IsTenantDatabase).
// Loading and replacing rewrite catalogue rows of the connection, which cached datasets hold, so they carry IChangesConnection.

public record ListImportsQuery(long DatasetId, long TenantId) : IRequest<Result<IReadOnlyList<ImportTableDto>>>;

public record PreviewImportQuery(long DatasetId, ImportFile File, ImportOptions Options, long TenantId) : IRequest<Result<ImportPreviewDto>>;

public record CreateImportCommand(long DatasetId, ImportFile File, ImportOptions Options, long TenantId, long UserId)
    : IRequest<Result<ImportTableDto>>, IChangesConnection;

public record ReplaceImportCommand(long DatasetId, long ImportId, ImportFile File, ImportOptions Options, long TenantId, long UserId)
    : IRequest<Result<ImportTableDto>>, IChangesConnection;
