using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

/// <summary>Replaces the dataset's notes; a row with neither a note nor a display name is dropped, notes capped at 1000 characters.</summary>
public sealed record SaveAiDatasetNotesCommand(long TenantId, string UserId, string SourceType, long SourceId, IReadOnlyList<AiDatasetNoteDto> Notes) : IRequest<IReadOnlyList<AiDatasetNoteDto>>;
/// <summary>Replaces the dataset's metrics.</summary>
public sealed record SaveAiDatasetMetricsCommand(long TenantId, string UserId, string SourceType, long SourceId, IReadOnlyList<AiMetricDto> Metrics) : IRequest<IReadOnlyList<AiMetricDto>>;
/// <summary>Replaces the dataset's business terms.</summary>
public sealed record SaveAiDatasetTermsCommand(long TenantId, string UserId, string SourceType, long SourceId, IReadOnlyList<AiTermDto> Terms) : IRequest<IReadOnlyList<AiTermDto>>;
/// <summary>An admin overrides the AI's review of an example (approved or rejected); false when not found.</summary>
public sealed record SetAiExampleStatusCommand(long TenantId, long Id, string Status) : IRequest<bool>;
