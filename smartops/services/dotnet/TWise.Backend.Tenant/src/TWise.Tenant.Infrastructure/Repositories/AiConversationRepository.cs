using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class AiConversationRepository(TenantDbContext db) : IAiConversationRepository
{
    public async Task<IReadOnlyList<AiConversation>> ListAsync(long tenantId, string userId, CancellationToken ct) =>
        await db.AiConversations.Where(c => c.TenantId == tenantId && c.UserId == userId).OrderByDescending(c => c.ModifiedAt).Take(50).ToListAsync(ct);

    public Task<AiConversation?> GetAsync(long id, long tenantId, string userId, CancellationToken ct) =>
        db.AiConversations.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId && c.UserId == userId, ct);

    public async Task<IReadOnlyList<AiChatMessage>> GetMessagesAsync(long conversationId, CancellationToken ct) =>
        await db.AiChatMessages.Where(m => m.ConversationId == conversationId).OrderBy(m => m.Id).ToListAsync(ct);

    public Task<AiChatMessage?> GetMessageAsync(long messageId, CancellationToken ct) =>
        db.AiChatMessages.FirstOrDefaultAsync(m => m.Id == messageId, ct);

    public async Task AddAsync(AiConversation conversation, CancellationToken ct)
    {
        db.AiConversations.Add(conversation);
        await db.SaveChangesAsync(ct); // need the id for the messages
    }

    public Task AddMessageAsync(AiChatMessage message, CancellationToken ct)
    {
        db.AiChatMessages.Add(message);
        return Task.CompletedTask;
    }

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    // Traces older than 30 days are removed at most once an hour per process, not on every answer (a round trip).
    private static long nextCleanup;

    public async Task AddTraceAsync(AiTrace trace, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var due = Interlocked.Read(ref nextCleanup);
        if (now.Ticks >= due && Interlocked.CompareExchange(ref nextCleanup, now.AddHours(1).Ticks, due) == due)
            await db.AiTraces.Where(t => t.CreatedAt < now.AddDays(-30)).ExecuteDeleteAsync(ct);
        db.AiTraces.Add(trace);
        await db.SaveChangesAsync(ct);
    }

    public Task<AiTrace?> GetTraceAsync(long messageId, CancellationToken ct) =>
        db.AiTraces.AsNoTracking().FirstOrDefaultAsync(t => t.MessageId == messageId, ct);

    public async Task<(int Total, IReadOnlyList<(AiChatMessage Message, AiConversation Conversation, AiTrace? Trace)> Items)> SearchAnswersAsync(
        long tenantId, DateTime since, string? search, int skip, int take, CancellationToken ct)
    {
        var q = from m in db.AiChatMessages.AsNoTracking()
                join c in db.AiConversations.AsNoTracking() on m.ConversationId equals c.Id
                where c.TenantId == tenantId && m.Role == "assistant" && m.CreatedAt >= since
                select new { m, c };
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            // Matches the answer, the dataset or the conversation title (its first question).
            q = q.Where(x => x.m.Content.Contains(s) || x.c.SourceName.Contains(s) || x.c.Title.Contains(s) || x.c.UserId == s);
        }
        var total = await q.CountAsync(ct);
        var page = await q.OrderByDescending(x => x.m.Id).Skip(skip).Take(take).ToListAsync(ct);
        var ids = page.Select(x => x.m.Id).ToList();
        var traces = await db.AiTraces.AsNoTracking().Where(t => ids.Contains(t.MessageId)).ToDictionaryAsync(t => t.MessageId, ct);
        return (total, page.Select(x => (x.m, x.c, traces.GetValueOrDefault(x.m.Id))).ToList());
    }

    public Task<AiConversation?> GetForTenantAsync(long id, long tenantId, CancellationToken ct) =>
        db.AiConversations.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId, ct);

    public async Task<IReadOnlyDictionary<long, string>> GetQuestionsAsync(IReadOnlyCollection<long> assistantMessageIds, CancellationToken ct)
    {
        var answers = await db.AiChatMessages.AsNoTracking().Where(m => assistantMessageIds.Contains(m.Id)).Select(m => new { m.Id, m.ConversationId }).ToListAsync(ct);
        var convIds = answers.Select(a => a.ConversationId).Distinct().ToList();
        var users = await db.AiChatMessages.AsNoTracking().Where(m => convIds.Contains(m.ConversationId) && m.Role == "user")
            .Select(m => new { m.Id, m.ConversationId, m.Content }).ToListAsync(ct);
        return answers.ToDictionary(a => a.Id, a => users.Where(u => u.ConversationId == a.ConversationId && u.Id < a.Id).OrderByDescending(u => u.Id).FirstOrDefault()?.Content ?? "");
    }
}
