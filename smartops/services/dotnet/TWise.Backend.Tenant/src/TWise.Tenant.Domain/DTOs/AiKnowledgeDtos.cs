namespace TWise.Tenant.Domain.DTOs;

/// <summary>Column null is the dataset-level note.</summary>
public record AiDatasetNoteDto(string? Column, string Note, string? DisplayName = null);

public record AiRelationDto(long Id, string FromType, long FromId, string FromName, string FromColumn, string ToType, long ToId, string ToName, string ToColumn,
    string Status, double? Overlap, DateTime ModifiedAt);
public record AiRelationNodeDto(string SourceType, long SourceId, string Name, int Links);
/// <summary>The relationship graph: every dataset that takes part plus the links between them.</summary>
public record AiRelationGraphDto(IReadOnlyList<AiRelationNodeDto> Nodes, IReadOnlyList<AiRelationDto> Links);
public record DetectAiRelationsRequest(IReadOnlyList<string>? Datasets);
public record AddAiRelationRequest(string FromType, long FromId, string FromColumn, string ToType, long ToId, string ToColumn);
public record SetAiRelationStatusRequest(string Status);
/// <summary>What a detection run did.</summary>
public record AiRelationScanDto(int DatasetsScanned, int Suggested, int Kept, IReadOnlyList<string> Skipped);

public record AiNoteProposalDto(long Id, string? Column, string Note, string Confidence, string Question, DateTime CreatedAt);

/// <summary>Column null only for count.</summary>
public record AiMetricDto(string Name, string Agg, string? Column, string? Description);

/// <summary>Synonyms comma separated. Column + Value make the term a filter; Meaning explains anything else.</summary>
public record AiTermDto(string Term, string? Synonyms, string? Column, string? Value, string? Meaning);

public record AiExampleStatusRequest(string Status);

/// <summary>Sql: an Ask Data example's query (Ask Data answers have no spec).</summary>
public record AiExampleDto(long Id, long MessageId, string Question, AiQuerySpec? QuerySpec, string CreatedBy, DateTime CreatedAt, string Status, string? Review,
    string? Sql = null);

/// <summary>An Ask Data table link drawn by an admin: "schema.table.column" each.</summary>
public record AddAskDataLinkRequest(string From, string To);
