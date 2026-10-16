using FluentValidation;

namespace TWise.Tenant.Application.Features.ReportTemplates;

public sealed class SaveReportTemplateCommandValidator : AbstractValidator<SaveReportTemplateCommand>
{
    private static readonly string[] AllowedSourceTypes = ["View", "Table"];
    private static readonly string[] AllowedTypes = ["Chart", "Report", "Tile"];

    public SaveReportTemplateCommandValidator()
    {
        RuleFor(x => x.Request.CustomName)
            .NotEmpty().WithMessage("Custom name is required.")
            .MaximumLength(200).WithMessage("Custom name must not exceed 200 characters.");

        RuleFor(x => x.Request.SourceName)
            .NotEmpty().WithMessage("Source name is required.")
            .MaximumLength(200).WithMessage("Source name must not exceed 200 characters.");

        RuleFor(x => x.Request.SourceType)
            .NotEmpty().WithMessage("Source type is required.")
            .Must(t => AllowedSourceTypes.Contains(t))
                .WithMessage("Source type must be 'View' or 'Table'.");

        RuleFor(x => x.Request.Type)
            .NotEmpty().WithMessage("Type is required.")
            .Must(t => AllowedTypes.Contains(t))
                .WithMessage("Type must be 'Chart', 'Report' or 'Tile'.");

        RuleFor(x => x.Request.TemplateJson)
            .NotEmpty().WithMessage("Template design is required.");
    }
}
