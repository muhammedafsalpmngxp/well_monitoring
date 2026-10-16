using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.SqlReview;

/// <summary>Explains a view's SQL, lists issues and suggestions and proposes an optimised query; null when the connection is not the tenant's.</summary>
public sealed record ReviewSqlCommand(AiSqlReviewRequest Request, long TenantId, long UserId) : IRequest<AiSqlReviewDto?>;
