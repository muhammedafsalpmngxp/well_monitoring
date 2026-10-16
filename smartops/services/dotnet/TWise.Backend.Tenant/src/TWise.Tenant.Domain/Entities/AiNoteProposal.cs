namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A business rule the model believes it learned from a conversation, waiting for an admin to approve
/// it into AiDatasetNotes or reject it. Maps to core.AiNoteProposals.
/// </summary>
public class AiNoteProposal
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    /// <summary>Null = about the whole dataset.</summary>
    public string? ColumnName { get; set; }
    public string Note { get; set; } = "";
    /// <summary>low | medium | high, as stated by the model.</summary>
    public string Confidence { get; set; } = "medium";
    /// <summary>The question that produced it, for the reviewer's context.</summary>
    public string Question { get; set; } = "";
    /// <summary>pending | approved | rejected</summary>
    public string Status { get; set; } = "pending";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? ReviewedBy { get; set; }
    public DateTime? ReviewedAt { get; set; }
}
