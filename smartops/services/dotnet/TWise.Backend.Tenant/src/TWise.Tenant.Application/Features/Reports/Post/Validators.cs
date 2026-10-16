using FluentValidation;

namespace TWise.Tenant.Application.Features.Reports;

public sealed class CreateReportCommandValidator : AbstractValidator<CreateReportCommand>
{
    private static readonly string[] AllowedSourceTypes = ["View", "Table"];

    public CreateReportCommandValidator()
    {
        RuleFor(x => x.Request.ReportName)
            .NotEmpty().WithMessage("Report name is required.")
            .MaximumLength(200).WithMessage("Report name must not exceed 200 characters.")
            .Matches(@"^[a-zA-Z0-9 _\-\.]+$")
                .WithMessage("Report name can only contain letters, numbers, spaces, hyphens, underscores, and dots. Special characters are not allowed.");

        RuleFor(x => x.Request.CategoryId)
            .GreaterThan(0).WithMessage("Category is required and must be a valid category ID.");

        RuleFor(x => x.Request.SourceName)
            .NotEmpty().WithMessage("Source name is required.")
            .MaximumLength(200).WithMessage("Source name must not exceed 200 characters.");

        RuleFor(x => x.Request.SourceType)
            .NotEmpty().WithMessage("Source type is required.")
            .Must(t => AllowedSourceTypes.Contains(t))
                .WithMessage("Source type must be 'View' or 'Table'.");

        RuleFor(x => x.Request.Description)
            .MaximumLength(500).WithMessage("Description must not exceed 500 characters.");
    }
}
