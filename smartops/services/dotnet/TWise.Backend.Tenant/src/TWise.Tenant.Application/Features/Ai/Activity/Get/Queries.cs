using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Activity;

/// <summary>Every user's answered questions in the last Days, newest first, optionally filtered by text (admin).</summary>
public sealed record GetAiActivityQuery(long TenantId, int Days, string? Search, int Skip, int Take) : IRequest<AiActivityPageDto>;

/// <summary>The steps behind any user's answer (admin); null when the message or its trace is gone.</summary>
public sealed record GetAiActivityTraceQuery(long TenantId, long MessageId) : IRequest<IReadOnlyList<AiTraceStep>?>;

/// <summary>Failed AI calls in the last Days, newest first (admin).</summary>
public sealed record GetAiFailuresQuery(long TenantId, int Days, int Take) : IRequest<IReadOnlyList<AiFailureDto>>;
