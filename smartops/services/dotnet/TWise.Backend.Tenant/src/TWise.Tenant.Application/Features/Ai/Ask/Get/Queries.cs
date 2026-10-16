using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Ask;

public sealed record ListAiDatasetsQuery(long TenantId, long UserId) : IRequest<IReadOnlyList<AiDatasetDto>>;
/// <summary>Column names of a dataset as the ask loads it; throws KeyNotFoundException when the dataset is gone.</summary>
public sealed record GetAiDatasetColumnsQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<string>>;
