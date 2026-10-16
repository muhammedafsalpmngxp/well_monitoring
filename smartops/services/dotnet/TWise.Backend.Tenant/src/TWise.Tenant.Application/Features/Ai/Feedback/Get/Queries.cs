using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Feedback;

/// <summary>The steps behind the user's own answer; null when not theirs or no trace kept. Throws InvalidOperationException without the Prompt trace feature.</summary>
public sealed record GetAiMessageTraceQuery(long TenantId, long UserId, long MessageId) : IRequest<IReadOnlyList<AiTraceStep>?>;
