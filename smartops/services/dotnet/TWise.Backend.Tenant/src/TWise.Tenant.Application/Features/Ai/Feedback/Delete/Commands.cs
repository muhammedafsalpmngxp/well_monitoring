using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Feedback;

/// <summary>Removes the thumbs-up.</summary>
public sealed record UnlikeAiMessageCommand(long TenantId, long UserId, long MessageId) : IRequest<bool>;
