using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed class ReviewAiNoteProposalHandler(IAiAskService ask) : IRequestHandler<ReviewAiNoteProposalCommand, bool>
{
    public Task<bool> Handle(ReviewAiNoteProposalCommand c, CancellationToken ct) => ask.ReviewProposalAsync(c.Id, c.Approve, c.TenantId, c.UserId, ct);
}
