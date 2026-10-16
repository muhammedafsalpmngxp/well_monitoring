using FluentValidation;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DaxModels;

/// <summary>Rules shared by create and update.</summary>
public sealed class DaxModelSaveRequestValidator : AbstractValidator<DaxModelSaveRequest>
{
    public DaxModelSaveRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Name is required.").MaximumLength(128);
        RuleFor(x => x.SourceType).Must(s => s is "Table" or "View").WithMessage("SourceType must be Table or View.");
        RuleFor(x => x.DataSource).NotEmpty().WithMessage("DataSource is required.").MaximumLength(256);
        RuleFor(x => x.CalculatedBy).Must(s => s is "Column" or "Row").WithMessage("CalculatedBy must be Column or Row.");
        RuleFor(x => x.Operation).MaximumLength(64);
        RuleFor(x => x.Expression).NotEmpty().WithMessage("Expression is required.").MaximumLength(4000);
        RuleFor(x => x.Status).Must(s => s is null or "Active" or "Draft").WithMessage("Status must be Active or Draft.");
    }
}
