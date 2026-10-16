using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

/// <summary>Confirms or rejects a link (or puts it back to suggested); null when not found.</summary>
public sealed record SetAiRelationStatusCommand(long TenantId, string UserId, long Id, string Status) : IRequest<AiRelationDto?>;
