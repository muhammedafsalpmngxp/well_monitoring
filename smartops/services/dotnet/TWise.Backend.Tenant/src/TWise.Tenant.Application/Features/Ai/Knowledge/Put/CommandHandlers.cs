using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed class SaveAiDatasetNotesHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<SaveAiDatasetNotesCommand, IReadOnlyList<AiDatasetNoteDto>>
{
    public async Task<IReadOnlyList<AiDatasetNoteDto>> Handle(SaveAiDatasetNotesCommand c, CancellationToken ct)
    {
        // A display name only makes sense for a column; the dataset-level row keeps just its note.
        var rows = (c.Notes ?? [])
            .Where(n => !string.IsNullOrWhiteSpace(n.Note) || (!string.IsNullOrWhiteSpace(n.Column) && !string.IsNullOrWhiteSpace(n.DisplayName)))
            .GroupBy(n => n.Column?.Trim() ?? "", StringComparer.OrdinalIgnoreCase).Select(g => g.Last())
            .Select(n => new AiDatasetNote
            {
                TenantId = c.TenantId, SourceType = c.SourceType, SourceId = c.SourceId,
                ColumnName = string.IsNullOrWhiteSpace(n.Column) ? null : n.Column.Trim(),
                Note = AiKnowledgeRules.Clean(n.Note, 1000) ?? "",
                DisplayName = string.IsNullOrWhiteSpace(n.Column) ? null : AiKnowledgeRules.Clean(n.DisplayName, 200),
                ModifiedBy = c.UserId,
            }).ToList();
        await knowledge.ReplaceNotesAsync(c.TenantId, c.SourceType, c.SourceId, rows, ct);
        return rows.Select(n => new AiDatasetNoteDto(n.ColumnName, n.Note, n.DisplayName)).ToList();
    }
}

public sealed class SaveAiDatasetMetricsHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<SaveAiDatasetMetricsCommand, IReadOnlyList<AiMetricDto>>
{
    public async Task<IReadOnlyList<AiMetricDto>> Handle(SaveAiDatasetMetricsCommand c, CancellationToken ct)
    {
        var rows = (c.Metrics ?? []).Select(m => new AiMetric
        {
            TenantId = c.TenantId, SourceType = c.SourceType, SourceId = c.SourceId, Name = m.Name.Trim(),
            Agg = AiKnowledgeRules.Aggregations.First(a => string.Equals(a, m.Agg.Trim(), StringComparison.OrdinalIgnoreCase)),
            ColumnName = AiKnowledgeRules.Clean(m.Column, 200), Description = AiKnowledgeRules.Clean(m.Description, 500), ModifiedBy = c.UserId,
        }).ToList();
        await knowledge.ReplaceMetricsAsync(c.TenantId, c.SourceType, c.SourceId, rows, ct);
        return rows.Select(r => new AiMetricDto(r.Name, r.Agg, r.ColumnName, r.Description)).ToList();
    }
}

public sealed class SaveAiDatasetTermsHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<SaveAiDatasetTermsCommand, IReadOnlyList<AiTermDto>>
{
    public async Task<IReadOnlyList<AiTermDto>> Handle(SaveAiDatasetTermsCommand c, CancellationToken ct)
    {
        var rows = new List<AiTerm>();
        foreach (var t in c.Terms ?? [])
        {
            var term = AiKnowledgeRules.Clean(t.Term, 100);
            if (term is null) continue;
            var synonyms = AiKnowledgeRules.Synonyms(t.Synonyms);
            rows.Add(new AiTerm
            {
                TenantId = c.TenantId, SourceType = c.SourceType, SourceId = c.SourceId, Term = term,
                Synonyms = synonyms.Count == 0 ? null : AiKnowledgeRules.Clean(string.Join(", ", synonyms), 500),
                ColumnName = AiKnowledgeRules.Clean(t.Column, 200), Value = AiKnowledgeRules.Clean(t.Value, 400), Meaning = AiKnowledgeRules.Clean(t.Meaning, 500), ModifiedBy = c.UserId,
            });
        }
        await knowledge.ReplaceTermsAsync(c.TenantId, c.SourceType, c.SourceId, rows, ct);
        return rows.Select(r => new AiTermDto(r.Term, r.Synonyms, r.ColumnName, r.Value, r.Meaning)).ToList();
    }
}

public sealed class SetAiExampleStatusHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<SetAiExampleStatusCommand, bool>
{
    public async Task<bool> Handle(SetAiExampleStatusCommand c, CancellationToken ct)
    {
        var e = await knowledge.GetExampleAsync(c.Id, c.TenantId, ct);
        if (e is null) return false;
        e.Status = c.Status;
        // The AI's reason no longer explains the status once an admin overrides it.
        e.Review = "Set by an admin.";
        await knowledge.SaveAsync(ct);
        return true;
    }
}
