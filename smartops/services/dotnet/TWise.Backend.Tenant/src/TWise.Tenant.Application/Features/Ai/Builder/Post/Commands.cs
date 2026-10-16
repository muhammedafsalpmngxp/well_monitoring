using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Builder;

public sealed record SuggestAiFiltersCommand(AiFilterSuggestRequest Request, long TenantId, long UserId) : IRequest<IReadOnlyList<AiFilterSuggestion>>;
public sealed record EditChartByAiCommand(AiChartEditRequest Request, long TenantId, long UserId) : IRequest<AiChartEditResponse>;
public sealed record SuggestAiChartsCommand(AiChartSuggestRequest Request, long TenantId, long UserId) : IRequest<IReadOnlyList<AiChartSuggestion>>;
public sealed record SuggestAiDashboardCommand(AiDashboardSuggestRequest Request, long TenantId, long UserId) : IRequest<AiDashboardSuggestion>;
