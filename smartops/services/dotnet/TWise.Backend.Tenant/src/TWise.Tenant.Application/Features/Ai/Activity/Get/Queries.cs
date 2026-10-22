using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Activity;

/// <summary>
/// Every user's answered questions from From to To (inclusive UTC days; none = the last AiAdmin:ActivityDays), newest first,
/// optionally for one user and filtered by text (admin). Take null = AiAdmin:PageSize.
/// </summary>
public sealed record GetAiActivityQuery(long TenantId, DateOnly? From, DateOnly? To, string? UserId, string? Search, int Skip, int? Take) : IRequest<AiActivityPageDto>;

/// <summary>The steps behind any user's answer (admin); null when the message or its trace is gone.</summary>
public sealed record GetAiActivityTraceQuery(long TenantId, long MessageId) : IRequest<IReadOnlyList<AiTraceStep>?>;

/// <summary>Every AI call (any feature) in the period, newest first: by user, purpose, failures only and text in the model or error (admin).</summary>
public sealed record GetAiCallsQuery(long TenantId, DateOnly? From, DateOnly? To, string? UserId, string? Purpose, bool FailedOnly, string? Search, int Skip, int? Take)
    : IRequest<AiCallsPageDto>;
