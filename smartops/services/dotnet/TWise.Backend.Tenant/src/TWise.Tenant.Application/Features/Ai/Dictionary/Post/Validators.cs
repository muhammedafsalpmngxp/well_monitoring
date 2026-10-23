using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Dictionary;

public sealed class DraftDictionaryCommandValidator : AbstractValidator<DraftDictionaryCommand>
{
    public DraftDictionaryCommandValidator()
    {
        RuleFor(x => x.Kind).Must(k => k is "import" or "view").WithMessage("The dataset kind must be import or view.");
        RuleFor(x => x.Id).GreaterThan(0);
    }
}
