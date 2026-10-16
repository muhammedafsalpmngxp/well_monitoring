using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Feedback;

/// <summary>Thumbs-up: keeps the answer as an example. False when the message is not the user's.</summary>
public sealed record LikeAiMessageCommand(long TenantId, long UserId, long MessageId) : IRequest<bool>;
/// <summary>Thumbs-down: the answer is never used as an example.</summary>
public sealed record DislikeAiMessageCommand(long TenantId, long UserId, long MessageId) : IRequest<bool>;
/// <summary>Insight report for the user's own answer; null when not theirs.</summary>
public sealed record BuildAiInsightReportCommand(long TenantId, long UserId, long MessageId) : IRequest<AiInsightReportDto?>;
