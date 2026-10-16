using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Feedback;

public sealed class GetAiMessageTraceHandler(IAiAskService ask) : IRequestHandler<GetAiMessageTraceQuery, IReadOnlyList<AiTraceStep>?>
{
    public Task<IReadOnlyList<AiTraceStep>?> Handle(GetAiMessageTraceQuery q, CancellationToken ct) => ask.GetTraceAsync(q.MessageId, q.TenantId, q.UserId, ct);
}
