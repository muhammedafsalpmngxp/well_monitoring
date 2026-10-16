using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed record GetAiDatasetNotesQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<AiDatasetNoteDto>>;
public sealed record GetAiDatasetMetricsQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<AiMetricDto>>;
public sealed record GetAiDatasetTermsQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<AiTermDto>>;
/// <summary>Notes the AI proposed from conversations and no admin has reviewed yet.</summary>
public sealed record GetAiNoteProposalsQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<AiNoteProposalDto>>;
/// <summary>Learned examples of a dataset with their review status.</summary>
public sealed record GetAiExamplesQuery(long TenantId, string SourceType, long SourceId) : IRequest<IReadOnlyList<AiExampleDto>>;
