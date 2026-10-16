using FluentValidation;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public sealed class CreateDatabaseViewValidator : AbstractValidator<CreateDatabaseViewCommand>
{
    public CreateDatabaseViewValidator()
    {
        RuleFor(x => x.Request.ConnectionId)
            .GreaterThan(0).WithMessage("ConnectionId is required.");

RuleFor(x => x.Request.ViewName)
    .NotEmpty().WithMessage("ViewName is required.")
    .MaximumLength(128).WithMessage("ViewName must not exceed 128 characters.")
    .Matches(@"^[a-zA-Z_][a-zA-Z0-9_ ]*$").WithMessage("ViewName must start with a letter or underscore and contain only letters, digits, spaces, and underscores.");

RuleFor(x => x.Request.Description)
    .MaximumLength(500).WithMessage("Description must not exceed 500 characters.");

        // Table-based fields only required when no referenced sources AND no generated SQL already provided
        When(x => string.IsNullOrEmpty(x.Request.ReferencedComponentIdsJson)
                  && string.IsNullOrEmpty(x.Request.ReferencedCteIdsJson)
                  && string.IsNullOrEmpty(x.Request.GeneratedSql), () =>
        {
            RuleFor(x => x.Request.TablesJson)
                .NotEmpty().WithMessage("At least one table must be selected.");

            RuleFor(x => x.Request.JoinsJson)
                .NotEmpty().WithMessage("JoinsJson is required.");

            RuleFor(x => x.Request.SelectedColumnsJson)
                .NotEmpty().WithMessage("At least one column must be selected.");

            RuleFor(x => x.Request.TablesUsed)
                .NotEmpty().WithMessage("TablesUsed is required.");
        });

        RuleFor(x => x.Request.GeneratedSql)
            .NotEmpty().WithMessage("GeneratedSql is required.");

        // RuleFor(x => x.Request.ColumnCount)
        //     .GreaterThan(0).WithMessage("At least one column must be selected.");

        RuleFor(x => x.Request.ViewType)
            .Must(v => v is "view" or "cte" or "component")
            .WithMessage("ViewType must be 'view', 'cte', or 'component'.");
    }
}
