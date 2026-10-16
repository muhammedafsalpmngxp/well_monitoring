using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Builder;

public sealed class SuggestAiFiltersHandler(IAiAskService ask) : IRequestHandler<SuggestAiFiltersCommand, IReadOnlyList<AiFilterSuggestion>>
{
    public Task<IReadOnlyList<AiFilterSuggestion>> Handle(SuggestAiFiltersCommand c, CancellationToken ct) => ask.SuggestFiltersAsync(c.Request, c.TenantId, c.UserId, ct);
}

public sealed class EditChartByAiHandler(IAiAskService ask) : IRequestHandler<EditChartByAiCommand, AiChartEditResponse>
{
    public Task<AiChartEditResponse> Handle(EditChartByAiCommand c, CancellationToken ct) => ask.EditChartAsync(c.Request, c.TenantId, c.UserId, ct);
}

public sealed class SuggestAiChartsHandler(IAiAskService ask) : IRequestHandler<SuggestAiChartsCommand, IReadOnlyList<AiChartSuggestion>>
{
    public Task<IReadOnlyList<AiChartSuggestion>> Handle(SuggestAiChartsCommand c, CancellationToken ct) => ask.SuggestChartsAsync(c.Request, c.TenantId, c.UserId, ct);
}

public sealed class SuggestAiDashboardHandler(IAiAskService ask) : IRequestHandler<SuggestAiDashboardCommand, AiDashboardSuggestion>
{
    public Task<AiDashboardSuggestion> Handle(SuggestAiDashboardCommand c, CancellationToken ct) => ask.SuggestDashboardAsync(c.Request, c.TenantId, c.UserId, ct);
}
