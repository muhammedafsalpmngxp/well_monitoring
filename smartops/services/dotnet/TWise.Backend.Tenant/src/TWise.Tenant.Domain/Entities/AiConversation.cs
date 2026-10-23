namespace TWise.Tenant.Domain.Entities;

/// <summary>A user's "ask your data" thread against one dataset. Maps to core.AiConversations.</summary>
public class AiConversation
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string UserId { get; set; } = "";
    /// <summary>view | import</summary>
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    public string SourceName { get; set; } = "";
    /// <summary>First question, trimmed, so the list is readable.</summary>
    public string Title { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}

/// <summary>One turn. For assistant turns QuerySpecJson holds the spec that produced the answer. Maps to core.AiChatMessages.</summary>
public class AiChatMessage
{
    public long Id { get; set; }
    public long ConversationId { get; set; }
    /// <summary>user | assistant</summary>
    public string Role { get; set; } = "";
    public string Content { get; set; } = "";
    public string? QuerySpecJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>The steps behind one answer: what was sent to the AI, what came back, timings. Maps to core.AiTraces; kept 30 days.</summary>
public class AiTrace
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    /// <summary>List of AiTraceStep as JSON.</summary>
    public string TraceJson { get; set; } = "";
    /// <summary>Ask Data: every query refused on the way to the answer and why, as JSON
    /// [{stage: validator | database | verifier, sql, reason, subQuestion}]; null when none was refused.</summary>
    public string? RejectionsJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
