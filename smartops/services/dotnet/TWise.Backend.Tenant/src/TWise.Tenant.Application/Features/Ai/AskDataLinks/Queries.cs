using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataLinks;

/// <summary>Ask Data's table links (suggested, confirmed, rejected): joins where the database has no foreign key.</summary>
public sealed record GetAskDataLinksQuery(long TenantId) : IRequest<IReadOnlyList<AiRelationDto>>;

/// <summary>Asks the runtime for suggested links (from the column profiles) and stores them as suggested, replacing
/// the earlier suggestions; confirmed and rejected links stay.</summary>
public sealed record ScanAskDataLinksCommand(long TenantId, string UserId) : IRequest<IReadOnlyList<AiRelationDto>>;

/// <summary>A link drawn by an admin, stored as confirmed.</summary>
public sealed record AddAskDataLinkCommand(long TenantId, string UserId, AddAskDataLinkRequest Request) : IRequest<AiRelationDto>;
