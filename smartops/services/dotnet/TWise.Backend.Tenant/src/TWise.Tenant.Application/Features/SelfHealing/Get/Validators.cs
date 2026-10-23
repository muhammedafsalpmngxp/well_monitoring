using FluentValidation;

namespace TWise.Tenant.Application.Features.SelfHealing;

public sealed class GetSelfHealingOverviewQueryValidator : AbstractValidator<GetSelfHealingOverviewQuery>
{
    public GetSelfHealingOverviewQueryValidator(SelfHealingOptions options)
    {
        RuleFor(x => x.Days).Must(d => d is null || options.Days.Contains(d.Value))
            .WithMessage($"Days must be one of {string.Join(", ", options.Days)}.");
    }
}
