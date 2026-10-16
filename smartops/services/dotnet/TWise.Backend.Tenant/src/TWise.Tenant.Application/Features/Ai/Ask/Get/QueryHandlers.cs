using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Ask;

public sealed class ListAiDatasetsHandler(IAiAskService ask) : IRequestHandler<ListAiDatasetsQuery, IReadOnlyList<AiDatasetDto>>
{
    public Task<IReadOnlyList<AiDatasetDto>> Handle(ListAiDatasetsQuery q, CancellationToken ct) => ask.ListDatasetsAsync(q.TenantId, q.UserId, ct);
}

public sealed class GetAiDatasetColumnsHandler(IAiAskService ask) : IRequestHandler<GetAiDatasetColumnsQuery, IReadOnlyList<string>>
{
    public Task<IReadOnlyList<string>> Handle(GetAiDatasetColumnsQuery q, CancellationToken ct) => ask.ColumnsAsync(q.SourceType, q.SourceId, q.TenantId, ct);
}
