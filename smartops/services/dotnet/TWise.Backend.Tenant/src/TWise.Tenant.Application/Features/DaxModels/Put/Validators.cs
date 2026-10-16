using FluentValidation;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class UpdateDaxModelCommandValidator : AbstractValidator<UpdateDaxModelCommand>
{
    public UpdateDaxModelCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0);
        RuleFor(x => x.Request).SetValidator(new DaxModelSaveRequestValidator());
    }
}
