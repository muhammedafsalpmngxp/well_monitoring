using FluentValidation;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public sealed class GetViewIndexAdviceValidator : AbstractValidator<GetViewIndexAdviceQuery>
{
    public GetViewIndexAdviceValidator()
    {
        RuleFor(x => x.Request.ConnectionId)
            .GreaterThan(0).WithMessage("ConnectionId is required.");
        RuleFor(x => x.Request.Sql)
            .NotEmpty().WithMessage("Sql is required.")
            .MaximumLength(200_000).WithMessage("Sql must not exceed 200,000 characters.");
    }
}
