using FluentValidation;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class ListDaxModelsQueryValidator : AbstractValidator<ListDaxModelsQuery>
{
    public ListDaxModelsQueryValidator()
    {
        RuleFor(x => x.Page).GreaterThan(0);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 100);
        RuleFor(x => x.Status).Must(s => s is null or "Active" or "Draft").WithMessage("Status must be Active or Draft.");
        RuleFor(x => x.SinceDays).InclusiveBetween(1, 3650).When(x => x.SinceDays is not null);
        RuleFor(x => x.Search).MaximumLength(128);
    }
}
