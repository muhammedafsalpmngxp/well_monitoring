using System.Text.Json;
using FluentValidation;

namespace TWise.Tenant.Application.Features.Dashboards;

public class PatchDashboardLayoutCommandValidator : AbstractValidator<PatchDashboardLayoutCommand>
{
    private const int MaxConfigJsonLength = 65_536; // 64 KB

    public PatchDashboardLayoutCommandValidator()
    {
        RuleFor(x => x.DashboardId).GreaterThan(0).WithMessage("Dashboard ID is required.");

        RuleFor(x => x.ConfigJson)
            .NotEmpty().WithMessage("ConfigJson is required.")
            .MaximumLength(MaxConfigJsonLength).WithMessage($"ConfigJson must not exceed {MaxConfigJsonLength} characters.")
            .Must(BeValidJson).WithMessage("ConfigJson must be valid JSON.")
            .Must(DashboardKind.HasKnownKind).WithMessage(DashboardKind.UnknownKindMessage);
    }

    private static bool BeValidJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
