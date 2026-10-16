using FluentValidation;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class CreateDaxModelCommandValidator : AbstractValidator<CreateDaxModelCommand>
{
    public CreateDaxModelCommandValidator() => RuleFor(x => x.Request).SetValidator(new DaxModelSaveRequestValidator());
}
