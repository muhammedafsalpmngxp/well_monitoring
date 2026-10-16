using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Ask;

/// <summary>Streams the ask events (status, spec, result, insights, answer deltas, trace, done or error).</summary>
public sealed record AskAiStream(AiAskRequest Request, long TenantId, long UserId) : IStreamRequest<AiAskEvent>;
/// <summary>Streams a chart's narrative summary.</summary>
public sealed record SummarizeAiChartStream(AiSummaryRequest Request, long TenantId, long UserId) : IStreamRequest<AiAskEvent>;
/// <summary>Streams a dashboard's narrative summary.</summary>
public sealed record SummarizeAiDashboardStream(AiDashboardSummaryRequest Request, long TenantId, long UserId) : IStreamRequest<AiAskEvent>;
