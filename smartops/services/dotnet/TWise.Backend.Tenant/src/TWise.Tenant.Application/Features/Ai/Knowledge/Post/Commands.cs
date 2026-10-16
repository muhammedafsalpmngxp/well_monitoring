using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

/// <summary>Approves (adds to the notes) or rejects a proposed note; false when not found.</summary>
public sealed record ReviewAiNoteProposalCommand(long TenantId, string UserId, long Id, bool Approve) : IRequest<bool>;
