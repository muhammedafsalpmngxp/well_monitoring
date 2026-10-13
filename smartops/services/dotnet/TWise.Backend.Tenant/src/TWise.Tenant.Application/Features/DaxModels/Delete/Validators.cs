using FluentValidation;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class DeleteDaxModelCommandValidator : AbstractValidator<DeleteDaxModelCommand>
{
    public DeleteDaxModelCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0);
    }
}
