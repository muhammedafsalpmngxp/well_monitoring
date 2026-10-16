using MediatR;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

public sealed record DeleteAiRelationCommand(long TenantId, long Id) : IRequest<bool>;
