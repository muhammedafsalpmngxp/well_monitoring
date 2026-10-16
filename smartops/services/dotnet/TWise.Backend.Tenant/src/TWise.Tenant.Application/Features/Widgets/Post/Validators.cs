using FluentValidation;

namespace TWise.Tenant.Application.Features.Widgets;

public sealed class CreateWidgetCommandValidator : AbstractValidator<CreateWidgetCommand>
{
    private static readonly string[] AllowedTypes       = ["chart", "tile"];
    private static readonly string[] AllowedSourceTypes = ["Table", "View", "Import"];

    public CreateWidgetCommandValidator()
    {
        RuleFor(x => x.Request.Name)
            .NotEmpty().WithMessage("Widget name is required.")
            .MaximumLength(200).WithMessage("Widget name must not exceed 200 characters.");

        RuleFor(x => x.Request.Type)
            .NotEmpty().WithMessage("Type is required.")
            .Must(t => AllowedTypes.Contains(t?.ToLower()))
            .WithMessage("Type must be 'chart' or 'tile'.");

        RuleFor(x => x.Request.Source)
            .NotEmpty().WithMessage("Source is required.")
            .MaximumLength(200).WithMessage("Source must not exceed 200 characters.");

        RuleFor(x => x.Request.SourceType)
            .NotEmpty().WithMessage("SourceType is required.")
            .Must(t => AllowedSourceTypes.Contains(t))
            .WithMessage("SourceType must be 'Table', 'View', or 'Import'.");
    }
}
