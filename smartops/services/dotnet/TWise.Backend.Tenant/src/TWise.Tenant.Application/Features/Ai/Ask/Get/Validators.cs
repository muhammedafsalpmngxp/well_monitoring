using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Ask;

public sealed class GetAiDatasetColumnsQueryValidator : AbstractValidator<GetAiDatasetColumnsQuery>
{
    public GetAiDatasetColumnsQueryValidator() => RuleFor(x => x.SourceType).Must(AiSources.IsSourceType).WithMessage(AiSources.Message);
}
