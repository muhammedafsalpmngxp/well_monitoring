using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed class CreateAiAlertCommandValidator : AbstractValidator<CreateAiAlertCommand>
{
    public CreateAiAlertCommandValidator(AiAlertOptions options)
    {
        RuleFor(x => x.Request.MessageId).GreaterThan(0);
        RuleFor(x => x.Request.Kind).Must(k => AlertCheck.IsKind((k ?? "").Trim().ToLowerInvariant())).WithMessage("Choose above, below, unusual or change.");
        RuleFor(x => x.Request.EveryHours).Must(h => options.EveryHours.Contains(h)).WithMessage("Choose one of the offered check intervals.");
    }
}
