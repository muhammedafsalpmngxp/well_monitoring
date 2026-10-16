using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Deck;

public sealed class BuildAiDeckCommandValidator : AbstractValidator<BuildAiDeckCommand>
{
    public BuildAiDeckCommandValidator()
    {
        RuleFor(x => x.Request.Title).MaximumLength(200);
        RuleFor(x => x.Request.Charts).NotEmpty().WithMessage("There is no chart data for a deck yet.")
            .Must(c => c is null || c.Count <= BuildAiDeckHandler.MaxCharts).WithMessage($"A deck covers at most {BuildAiDeckHandler.MaxCharts} charts.");
    }
}
