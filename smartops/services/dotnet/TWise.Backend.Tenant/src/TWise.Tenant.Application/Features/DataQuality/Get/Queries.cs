using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public record ListValidationRulesQuery : IRequest<Result<ListRulesResponse>>;

public record ListOpenErrorsQuery : IRequest<Result<ListErrorsResponse>>;

/// <summary>Rules behind the reliability score of a chart source (table or view).</summary>
public record GetReliabilityDetailQuery(string? TableName, long? ViewId) : IRequest<Result<ReliabilityDetailResponse>>;
