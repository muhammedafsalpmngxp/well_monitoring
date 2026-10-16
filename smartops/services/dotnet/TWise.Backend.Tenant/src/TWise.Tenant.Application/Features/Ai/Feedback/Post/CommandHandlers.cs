using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Feedback;

public sealed class LikeAiMessageHandler(IAiAskService ask) : IRequestHandler<LikeAiMessageCommand, bool>
{
    public Task<bool> Handle(LikeAiMessageCommand c, CancellationToken ct) => ask.LikeAsync(c.MessageId, c.TenantId, c.UserId, ct);
}

public sealed class DislikeAiMessageHandler(IAiAskService ask) : IRequestHandler<DislikeAiMessageCommand, bool>
{
    public Task<bool> Handle(DislikeAiMessageCommand c, CancellationToken ct) => ask.DislikeAsync(c.MessageId, c.TenantId, c.UserId, ct);
}

public sealed class BuildAiInsightReportHandler(IAiAskService ask) : IRequestHandler<BuildAiInsightReportCommand, AiInsightReportDto?>
{
    public Task<AiInsightReportDto?> Handle(BuildAiInsightReportCommand c, CancellationToken ct) => ask.ReportAsync(c.MessageId, c.TenantId, c.UserId, ct);
}
