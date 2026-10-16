namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A business note about a dataset (ColumnName null) or one of its columns, written by an admin and
/// injected into the AI prompt so the model knows what "Unit Price" or "status = 3" means here.
/// Maps to core.AiDatasetNotes.
/// </summary>
/// <summary>
/// One AI instruction overridden for a dataset (Key is an AiPrompts key from DatasetKeys); the
/// tenant-wide text applies where no row exists. Maps to core.AiDatasetPrompts.
/// </summary>
public class AiDatasetPrompt
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    /// <summary>view | import</summary>
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    public string Key { get; set; } = "";
    public string Text { get; set; } = "";
    public string? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A link between two datasets through a shared column (the relationship graph): suggested by the
/// column-name and value-overlap scan, or added by an admin, then confirmed or rejected. Confirmed
/// links are told to the AI so it can point to the dataset that has what a question asks for.
/// Maps to core.AiDatasetRelations.
/// </summary>
public class AiDatasetRelation
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string FromType { get; set; } = "";
    public long FromId { get; set; }
    public string FromName { get; set; } = "";
    public string FromColumn { get; set; } = "";
    public string ToType { get; set; } = "";
    public long ToId { get; set; }
    public string ToName { get; set; } = "";
    public string ToColumn { get; set; } = "";
    /// <summary>suggested | confirmed | rejected</summary>
    public string Status { get; set; } = "suggested";
    /// <summary>Share of the from-column's sample values also found in the to-column (0–1); null when not measured.</summary>
    public double? Overlap { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}

public class AiDatasetNote
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    /// <summary>view | import</summary>
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    public string? ColumnName { get; set; }
    public string Note { get; set; } = "";
    /// <summary>What people call this column (e.g. "FLAF score" for bl_flaf_scr); used in table headers, prompts and answers.</summary>
    public string? DisplayName { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A question and the query spec that answered it well (the user gave it a thumbs-up). The best
/// matches are shown to the model as examples for later questions on the same dataset.
/// Maps to core.AiExamples.
/// </summary>
public class AiExample
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    /// <summary>The assistant message this came from, so a second thumbs-up is a no-op and un-liking can remove it.</summary>
    public long MessageId { get; set; }
    public string Question { get; set; } = "";
    public string QuerySpecJson { get; set; } = "";
    /// <summary>
    /// liked (thumbs-up) | approved (the model's review, or an admin, judged it right) | pending (review not done) |
    /// rejected (judged wrong) | disliked (thumbs-down). Only liked and approved guide later questions.
    /// </summary>
    public string Status { get; set; } = AiExampleStatus.Liked;
    /// <summary>Why the model judged it right or wrong.</summary>
    public string? Review { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class AiExampleStatus
{
    public const string Liked = "liked", Approved = "approved", Pending = "pending", Rejected = "rejected", Disliked = "disliked";
    /// <summary>The statuses whose examples are put in the prompt.</summary>
    public static readonly string[] Used = [Liked, Approved];
}
