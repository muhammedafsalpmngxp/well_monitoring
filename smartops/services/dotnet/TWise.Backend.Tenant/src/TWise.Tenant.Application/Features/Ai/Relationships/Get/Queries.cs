using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

/// <summary>The tenant's relationship graph: datasets that take part in a link, and every link with its status.</summary>
public sealed record GetAiRelationGraphQuery(long TenantId) : IRequest<AiRelationGraphDto>;
