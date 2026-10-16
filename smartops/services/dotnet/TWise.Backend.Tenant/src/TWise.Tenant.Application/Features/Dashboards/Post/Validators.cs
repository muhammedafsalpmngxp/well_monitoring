using System.Text.Json;
using System.Text.RegularExpressions;
using FluentValidation;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Dashboards;

/// <summary>
/// Shared validation rules for dashboard name.
/// </summary>
public static class DashboardValidationRules
{
    private static readonly Regex ValidNameRegex = new(@"^[a-zA-Z0-9\s\-_()&]+$", RegexOptions.Compiled);
    private const int MaxConfigJsonLength = 65_536; // 64 KB

    public static IRuleBuilderOptions<T, string> ValidDashboardName<T>(this IRuleBuilder<T, string> rule)
    {
        return rule
            .NotEmpty().WithMessage("Dashboard Name is required.")
            .Must(name => !string.IsNullOrWhiteSpace(name))
            .WithMessage("Dashboard Name cannot be empty or whitespace.")
            .Must(name => name == null || name == name.Trim())
            .WithMessage("Dashboard Name should not have leading or trailing spaces.")
            .MaximumLength(100).WithMessage("Dashboard Name should not exceed 100 characters.")
            .Must(name => name == null || ValidNameRegex.IsMatch(name.Trim()))
            .WithMessage("Dashboard Name contains invalid special characters. Only letters, numbers, spaces, hyphens, underscores, parentheses, and ampersand are allowed.");
    }

    public static IRuleBuilderOptions<T, string?> ValidConfigJson<T>(this IRuleBuilder<T, string?> rule)
    {
        return rule
            .MaximumLength(MaxConfigJsonLength).WithMessage($"ConfigJson must not exceed {MaxConfigJsonLength} characters.")
            .Must(BeValidJson).WithMessage("ConfigJson must be valid JSON.")
            .Must(DashboardKind.HasKnownKind).WithMessage(DashboardKind.UnknownKindMessage);
    }

    private static bool BeValidJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return true;
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

/// <summary>
/// Validator for CreateDashboardCommand — validates the inner SaveDashboardRequest.
/// </summary>
public class CreateDashboardCommandValidator : AbstractValidator<CreateDashboardCommand>
{
    public CreateDashboardCommandValidator()
    {
        RuleFor(x => x.Request.DashboardName).ValidDashboardName();
        RuleFor(x => x.Request.CategoryId).GreaterThan(0).WithMessage("Category is required.");
        RuleFor(x => x.Request.Description).MaximumLength(500).WithMessage("Description must not exceed 500 characters.");
        RuleFor(x => x.Request.ConfigJson).ValidConfigJson();
    }
}

/// <summary>
/// Validator for UpdateDashboardCommand — validates the inner SaveDashboardRequest.
/// </summary>
public class UpdateDashboardCommandValidator : AbstractValidator<UpdateDashboardCommand>
{
    public UpdateDashboardCommandValidator()
    {
        RuleFor(x => x.DashboardId).GreaterThan(0).WithMessage("Dashboard ID is required.");
        RuleFor(x => x.Request.DashboardName).ValidDashboardName();
        RuleFor(x => x.Request.CategoryId).GreaterThan(0).WithMessage("Category is required.");
        RuleFor(x => x.Request.Description).MaximumLength(500).WithMessage("Description must not exceed 500 characters.");
        RuleFor(x => x.Request.ConfigJson).ValidConfigJson();
    }
}
