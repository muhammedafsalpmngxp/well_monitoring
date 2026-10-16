using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Ask;

public sealed class AskAiStreamHandler(IAiAskService ask) : IStreamRequestHandler<AskAiStream, AiAskEvent>
{
    public IAsyncEnumerable<AiAskEvent> Handle(AskAiStream r, CancellationToken ct) => ask.AskAsync(r.Request, r.TenantId, r.UserId, ct);
}

public sealed class SummarizeAiChartStreamHandler(IAiAskService ask) : IStreamRequestHandler<SummarizeAiChartStream, AiAskEvent>
{
    public IAsyncEnumerable<AiAskEvent> Handle(SummarizeAiChartStream r, CancellationToken ct) => ask.SummarizeAsync(r.Request, r.TenantId, r.UserId, ct);
}

public sealed class SummarizeAiDashboardStreamHandler(IAiAskService ask) : IStreamRequestHandler<SummarizeAiDashboardStream, AiAskEvent>
{
    public IAsyncEnumerable<AiAskEvent> Handle(SummarizeAiDashboardStream r, CancellationToken ct) => ask.SummarizeDashboardAsync(r.Request, r.TenantId, r.UserId, ct);
}
