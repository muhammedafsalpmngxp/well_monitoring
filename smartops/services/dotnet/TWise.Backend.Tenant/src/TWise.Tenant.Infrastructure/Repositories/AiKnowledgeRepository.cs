using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class AiKnowledgeRepository(TenantDbContext db) : IAiKnowledgeRepository
{
    public async Task<IReadOnlyList<AiDatasetNote>> GetNotesAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        await db.AiDatasetNotes.Where(n => n.TenantId == tenantId && n.SourceType == sourceType && n.SourceId == sourceId)
            .OrderBy(n => n.ColumnName).ToListAsync(ct);

    public async Task ReplaceNotesAsync(long tenantId, string sourceType, long sourceId, IReadOnlyList<AiDatasetNote> notes, CancellationToken ct)
    {
        await db.AiDatasetNotes.Where(n => n.TenantId == tenantId && n.SourceType == sourceType && n.SourceId == sourceId).ExecuteDeleteAsync(ct);
        db.AiDatasetNotes.AddRange(notes);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiDatasetRelation>> GetRelationsAsync(long tenantId, CancellationToken ct) =>
        await db.AiDatasetRelations.Where(r => r.TenantId == tenantId).OrderBy(r => r.FromName).ThenBy(r => r.ToName).ToListAsync(ct);

    public Task<AiDatasetRelation?> GetRelationAsync(long id, long tenantId, CancellationToken ct) =>
        db.AiDatasetRelations.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId, ct);

    public Task AddRelationAsync(AiDatasetRelation relation, CancellationToken ct) { db.AiDatasetRelations.Add(relation); return Task.CompletedTask; }
    public Task RemoveRelationAsync(AiDatasetRelation relation, CancellationToken ct) { db.AiDatasetRelations.Remove(relation); return Task.CompletedTask; }

    public async Task RemoveSuggestedRelationsAsync(long tenantId, IReadOnlyCollection<string> datasetKeys, CancellationToken ct)
    {
        var rows = await db.AiDatasetRelations.Where(r => r.TenantId == tenantId && r.Status == "suggested").ToListAsync(ct);
        db.AiDatasetRelations.RemoveRange(rows.Where(r => datasetKeys.Contains($"{r.FromType}:{r.FromId}") && datasetKeys.Contains($"{r.ToType}:{r.ToId}")));
        await db.SaveChangesAsync(ct);
    }

    public Task SaveRelationsAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public async Task<IReadOnlyList<AiDatasetPrompt>> GetDatasetPromptsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        await db.AiDatasetPrompts.Where(p => p.TenantId == tenantId && p.SourceType == sourceType && p.SourceId == sourceId).ToListAsync(ct);

    public async Task UpsertDatasetPromptAsync(long tenantId, string sourceType, long sourceId, string key, string? text, string userId, CancellationToken ct)
    {
        var row = await db.AiDatasetPrompts.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.SourceType == sourceType && p.SourceId == sourceId && p.Key == key, ct);
        if (string.IsNullOrWhiteSpace(text)) { if (row is not null) db.AiDatasetPrompts.Remove(row); }
        else if (row is null) db.AiDatasetPrompts.Add(new AiDatasetPrompt { TenantId = tenantId, SourceType = sourceType, SourceId = sourceId, Key = key, Text = text, ModifiedBy = userId });
        else { row.Text = text; row.ModifiedBy = userId; row.ModifiedAt = DateTime.UtcNow; }
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiExample>> GetExamplesAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        await db.AiExamples.Where(e => e.TenantId == tenantId && e.SourceType == sourceType && e.SourceId == sourceId)
            // Liked first so automatically saved examples never push a person's choice out of the list.
            .OrderBy(e => e.Status == AiExampleStatus.Liked ? 0 : 1).ThenByDescending(e => e.Id).Take(400).ToListAsync(ct);

    public Task<AiExample?> GetExampleByMessageAsync(long messageId, CancellationToken ct) =>
        db.AiExamples.FirstOrDefaultAsync(e => e.MessageId == messageId, ct);

    public Task<AiExample?> GetExampleAsync(long id, long tenantId, CancellationToken ct) =>
        db.AiExamples.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId, ct);

    public async Task AddExampleAsync(AiExample example, CancellationToken ct)
    {
        db.AiExamples.Add(example);
        await db.SaveChangesAsync(ct);
    }

    public Task<bool> HasExampleForQuestionAsync(long tenantId, string sourceType, long sourceId, string question, CancellationToken ct) =>
        db.AiExamples.AnyAsync(e => e.TenantId == tenantId && e.SourceType == sourceType && e.SourceId == sourceId && e.Question == question, ct);

    public async Task PruneAutoExamplesAsync(long tenantId, string sourceType, long sourceId, int keep, CancellationToken ct)
    {
        string[] auto = [AiExampleStatus.Approved, AiExampleStatus.Pending, AiExampleStatus.Rejected];
        var old = await db.AiExamples
            .Where(e => e.TenantId == tenantId && e.SourceType == sourceType && e.SourceId == sourceId && auto.Contains(e.Status))
            .OrderByDescending(e => e.Id).Skip(keep).Select(e => e.Id).ToListAsync(ct);
        if (old.Count > 0) await db.AiExamples.Where(e => old.Contains(e.Id)).ExecuteDeleteAsync(ct);
    }

    public async Task RemoveExampleAsync(AiExample example, CancellationToken ct)
    {
        db.AiExamples.Remove(example);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiMetric>> GetMetricsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        await db.AiMetrics.Where(m => m.TenantId == tenantId && m.SourceType == sourceType && m.SourceId == sourceId).OrderBy(m => m.Name).ToListAsync(ct);

    public async Task ReplaceMetricsAsync(long tenantId, string sourceType, long sourceId, IReadOnlyList<AiMetric> metrics, CancellationToken ct)
    {
        await db.AiMetrics.Where(m => m.TenantId == tenantId && m.SourceType == sourceType && m.SourceId == sourceId).ExecuteDeleteAsync(ct);
        db.AiMetrics.AddRange(metrics);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiTerm>> GetTermsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        await db.AiTerms.Where(t => t.TenantId == tenantId && t.SourceType == sourceType && t.SourceId == sourceId).OrderBy(t => t.Term).ToListAsync(ct);

    public async Task ReplaceTermsAsync(long tenantId, string sourceType, long sourceId, IReadOnlyList<AiTerm> terms, CancellationToken ct)
    {
        await db.AiTerms.Where(t => t.TenantId == tenantId && t.SourceType == sourceType && t.SourceId == sourceId).ExecuteDeleteAsync(ct);
        db.AiTerms.AddRange(terms);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiNoteProposal>> GetPendingProposalsAsync(long tenantId, string sourceType, long sourceId, CancellationToken ct) =>
        await db.AiNoteProposals.Where(p => p.TenantId == tenantId && p.SourceType == sourceType && p.SourceId == sourceId && p.Status == "pending")
            .OrderByDescending(p => p.Id).Take(50).ToListAsync(ct);

    public Task<AiNoteProposal?> GetProposalAsync(long id, long tenantId, CancellationToken ct) =>
        db.AiNoteProposals.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId, ct);

    public async Task AddProposalsAsync(IReadOnlyList<AiNoteProposal> proposals, CancellationToken ct)
    {
        db.AiNoteProposals.AddRange(proposals);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpsertNoteAsync(long tenantId, string sourceType, long sourceId, string? column, string note, string userId, CancellationToken ct)
    {
        var existing = await db.AiDatasetNotes.FirstOrDefaultAsync(n => n.TenantId == tenantId && n.SourceType == sourceType && n.SourceId == sourceId && n.ColumnName == column, ct);
        if (existing is null)
            db.AiDatasetNotes.Add(new AiDatasetNote { TenantId = tenantId, SourceType = sourceType, SourceId = sourceId, ColumnName = column, Note = note, ModifiedBy = userId });
        else
        {
            var merged = existing.Note.Contains(note, StringComparison.OrdinalIgnoreCase) ? existing.Note : existing.Note.TrimEnd('.', ' ') + ". " + note;
            existing.Note = merged.Length > 1000 ? merged[..1000] : merged;
            existing.ModifiedBy = userId;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
