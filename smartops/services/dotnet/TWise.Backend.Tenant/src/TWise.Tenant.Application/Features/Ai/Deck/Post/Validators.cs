using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Deck;

public sealed class BuildAiDeckCommandValidator : AbstractValidator<BuildAiDeckCommand>
{
    public BuildAiDeckCommandValidator(AiExplainOptions explain)
    {
        RuleFor(x => x.Request.Title).MaximumLength(200);
        RuleFor(x => x.Request.Charts).NotEmpty().WithMessage("There is no chart data for a deck yet.")
            .Must(c => c is null || c.Count <= explain.DashboardCharts).WithMessage($"A deck covers at most {explain.DashboardCharts} charts.");
    }
}
