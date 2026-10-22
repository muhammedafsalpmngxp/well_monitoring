using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed class GetAiDatasetNotesQueryValidator : AbstractValidator<GetAiDatasetNotesQuery>
{
    public GetAiDatasetNotesQueryValidator() =>
        RuleFor(x => x.SourceType).Must((x, s) => AiSources.IsKnowledgeSource(s, x.SourceId)).WithMessage(AiSources.KnowledgeMessage);
}

public sealed class GetAiDatasetMetricsQueryValidator : AbstractValidator<GetAiDatasetMetricsQuery>
{
    public GetAiDatasetMetricsQueryValidator() =>
        RuleFor(x => x.SourceType).Must((x, s) => AiSources.IsKnowledgeSource(s, x.SourceId)).WithMessage(AiSources.KnowledgeMessage);
}

public sealed class GetAiDatasetTermsQueryValidator : AbstractValidator<GetAiDatasetTermsQuery>
{
    public GetAiDatasetTermsQueryValidator() =>
        RuleFor(x => x.SourceType).Must((x, s) => AiSources.IsKnowledgeSource(s, x.SourceId)).WithMessage(AiSources.KnowledgeMessage);
}

public sealed class GetAiNoteProposalsQueryValidator : AbstractValidator<GetAiNoteProposalsQuery>
{
    public GetAiNoteProposalsQueryValidator() =>
        RuleFor(x => x.SourceType).Must((x, s) => AiSources.IsKnowledgeSource(s, x.SourceId)).WithMessage(AiSources.KnowledgeMessage);
}

public sealed class GetAiExamplesQueryValidator : AbstractValidator<GetAiExamplesQuery>
{
    public GetAiExamplesQueryValidator() =>
        RuleFor(x => x.SourceType).Must((x, s) => AiSources.IsKnowledgeSource(s, x.SourceId)).WithMessage(AiSources.KnowledgeMessage);
}
