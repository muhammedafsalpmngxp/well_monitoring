using FluentValidation;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public sealed class CreateWidgetLibraryValidator : AbstractValidator<CreateWidgetLibraryCommand>
{
    private static readonly string[] AllowedTypes = ["chart", "tile"];

    public CreateWidgetLibraryValidator()
    {
        RuleFor(x => x.Request.WidgetName)
            .NotEmpty().WithMessage("WidgetName is required.")
            .MaximumLength(200).WithMessage("WidgetName must not exceed 200 characters.");

        RuleFor(x => x.Request.Type)
            .NotEmpty().WithMessage("Type is required.")
            .Must(t => AllowedTypes.Contains(t?.ToLower()))
            .WithMessage("Type must be 'chart' or 'tile'.");
    }
}
