using MediatR;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed class GetAiDatasetNotesHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAiDatasetNotesQuery, IReadOnlyList<AiDatasetNoteDto>>
{
    public async Task<IReadOnlyList<AiDatasetNoteDto>> Handle(GetAiDatasetNotesQuery q, CancellationToken ct) =>
        (await knowledge.GetNotesAsync(q.TenantId, q.SourceType, q.SourceId, ct)).Select(n => new AiDatasetNoteDto(n.ColumnName, n.Note, n.DisplayName)).ToList();
}

public sealed class GetAiDatasetMetricsHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAiDatasetMetricsQuery, IReadOnlyList<AiMetricDto>>
{
    public async Task<IReadOnlyList<AiMetricDto>> Handle(GetAiDatasetMetricsQuery q, CancellationToken ct) =>
        (await knowledge.GetMetricsAsync(q.TenantId, q.SourceType, q.SourceId, ct)).Select(m => new AiMetricDto(m.Name, m.Agg, m.ColumnName, m.Description)).ToList();
}

public sealed class GetAiDatasetTermsHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAiDatasetTermsQuery, IReadOnlyList<AiTermDto>>
{
    public async Task<IReadOnlyList<AiTermDto>> Handle(GetAiDatasetTermsQuery q, CancellationToken ct) =>
        (await knowledge.GetTermsAsync(q.TenantId, q.SourceType, q.SourceId, ct)).Select(t => new AiTermDto(t.Term, t.Synonyms, t.ColumnName, t.Value, t.Meaning)).ToList();
}

public sealed class GetAiNoteProposalsHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAiNoteProposalsQuery, IReadOnlyList<AiNoteProposalDto>>
{
    public async Task<IReadOnlyList<AiNoteProposalDto>> Handle(GetAiNoteProposalsQuery q, CancellationToken ct) =>
        (await knowledge.GetPendingProposalsAsync(q.TenantId, q.SourceType, q.SourceId, ct))
            .Select(p => new AiNoteProposalDto(p.Id, p.ColumnName, p.Note, p.Confidence, p.Question, AiDates.Utc(p.CreatedAt))).ToList();
}

public sealed class GetAiExamplesHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAiExamplesQuery, IReadOnlyList<AiExampleDto>>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<AiExampleDto>> Handle(GetAiExamplesQuery q, CancellationToken ct) =>
        (await knowledge.GetExamplesAsync(q.TenantId, q.SourceType, q.SourceId, ct))
            .Select(e => new AiExampleDto(e.Id, e.MessageId, e.Question, JsonSerializer.Deserialize<AiQuerySpec>(e.QuerySpecJson, Json), e.CreatedBy, AiDates.Utc(e.CreatedAt), e.Status, e.Review)).ToList();
}
