using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataSources;

// ── Queries ─────────────────────────────────────────────────────────────────

public record ListDataSourcesQuery(long TenantId) : IRequest<IReadOnlyList<DataSourceConnectionDto>>;

public record GetDataSourceQuery(long Id, long TenantId) : IRequest<DataSourceConnectionDto?>;

public record ListDataSourceObjectsQuery(long Id, long TenantId) : IRequest<IReadOnlyList<DataSourceObjectDto>?>;

public record GetDataSourceOptionsQuery : IRequest<DataSourceOptionsResponse>;

// ── Commands ────────────────────────────────────────────────────────────────

public record CreateDataSourceCommand(CreateDataSourceConnectionRequest Request, long UserId, long TenantId)
    : IRequest<DataSourceConnectionDto>;

public record UpdateDataSourceCommand(long Id, UpdateDataSourceConnectionRequest Request, long UserId, long TenantId)
    : IRequest<DataSourceConnectionDto?>;

public record DeleteDataSourceCommand(long Id, long TenantId) : IRequest<bool>;

public record TestDataSourceCommand(long Id, long TenantId) : IRequest<DataSourceTestResponse?>;

public record IngestDataSourceCommand(long Id, IngestDataSourceRequest Request, long UserId, long TenantId)
    : IRequest<ImportedDatasetDto?>;

public record SaveGoogleTokenCommand(long Id, string RefreshToken, long UserId, long TenantId) : IRequest<bool>;
