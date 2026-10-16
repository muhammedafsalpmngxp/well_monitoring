using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

/// <summary>Scans datasets ("view:12", "import:5"; empty = every dataset, capped) for shared columns and stores the links as suggested.</summary>
public sealed record DetectAiRelationsCommand(long TenantId, long UserId, IReadOnlyList<string>? Datasets) : IRequest<AiRelationScanDto>;

/// <summary>An admin-drawn link; stored as confirmed.</summary>
public sealed record AddAiRelationCommand(long TenantId, long UserId, AddAiRelationRequest Request) : IRequest<AiRelationDto>;
