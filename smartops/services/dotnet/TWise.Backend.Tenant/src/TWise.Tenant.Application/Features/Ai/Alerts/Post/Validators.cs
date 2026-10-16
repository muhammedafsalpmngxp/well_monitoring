using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed class CreateAiAlertCommandValidator : AbstractValidator<CreateAiAlertCommand>
{
    public CreateAiAlertCommandValidator()
    {
        RuleFor(x => x.Request.MessageId).GreaterThan(0);
        RuleFor(x => x.Request.Kind).Must(k => AlertCheck.IsKind((k ?? "").Trim().ToLowerInvariant())).WithMessage("Choose above, below, unusual or change.");
        RuleFor(x => x.Request.EveryHours).Must(h => AlertCheck.EveryHours.Contains(h)).WithMessage("Check hourly, daily or weekly.");
    }
}
