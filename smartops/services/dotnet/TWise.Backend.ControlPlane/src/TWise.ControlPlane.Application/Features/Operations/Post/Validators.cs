using FluentValidation;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public sealed class CreateIngestionRunValidator : AbstractValidator<CreateIngestionRunCommand>
{
    public CreateIngestionRunValidator()
    {
        RuleFor(x => x.Request.TenantSourceId)
            .GreaterThan(0).WithMessage("TenantSourceId is required.");

        RuleFor(x => x.Request.Status)
            .MaximumLength(20).WithMessage("Status must not exceed 20 characters.");

        RuleFor(x => x.Request)
            .Must(r => r.StartedAt is null || r.FinishedAt is null || r.StartedAt <= r.FinishedAt)
            .WithMessage("StartedAt must be before or equal to FinishedAt.");
    }
}

public sealed class CreateAuditEventValidator : AbstractValidator<CreateAuditEventCommand>
{
    public CreateAuditEventValidator()
    {
        RuleFor(x => x.Request.Action)
            .NotEmpty().WithMessage("Action is required.")
            .MaximumLength(80).WithMessage("Action must not exceed 80 characters.");

        RuleFor(x => x.Request.Entity)
            .MaximumLength(80).WithMessage("Entity must not exceed 80 characters.");
    }
}
