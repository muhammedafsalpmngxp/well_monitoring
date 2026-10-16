using System.Text.RegularExpressions;
using FluentValidation;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Categories;

public static class CategoryValidationRules
{
    private static readonly Regex ValidNameRegex = new(@"^[a-zA-Z0-9\s\-_()&]+$", RegexOptions.Compiled);
    private static readonly string[] AllowedControlTypes = ["dashboard", "chart", "tile", "report"];

    public static IRuleBuilderOptions<T, string> ValidCategoryName<T>(this IRuleBuilder<T, string> rule)
    {
        return rule
            .NotEmpty().WithMessage("Category Name is required.")
            .Must(name => name == null || name == name.Trim())
            .WithMessage("Category Name should not have leading or trailing spaces.")
            .MaximumLength(100).WithMessage("Category Name should not exceed 100 characters.")
            .Must(name => name == null || ValidNameRegex.IsMatch(name.Trim()))
            .WithMessage("Category Name contains invalid special characters. Only letters, numbers, spaces, hyphens, underscores, parentheses, and ampersand are allowed.");
    }

    public static IRuleBuilderOptions<T, string> ValidControlType<T>(this IRuleBuilder<T, string> rule)
    {
        return rule
            .NotEmpty().WithMessage("ControlType is required.")
            .Must(t => AllowedControlTypes.Contains(t, StringComparer.OrdinalIgnoreCase))
            .WithMessage("ControlType must be one of: dashboard, chart, tile, report.");
    }
}

public class CreateCategoryCommandValidator : AbstractValidator<CreateCategoryCommand>
{
    public CreateCategoryCommandValidator()
    {
        RuleFor(x => x.Request.CategoryName).ValidCategoryName();
        RuleFor(x => x.Request.ControlType).ValidControlType();
    }
}

public class UpdateCategoryCommandValidator : AbstractValidator<UpdateCategoryCommand>
{
    public UpdateCategoryCommandValidator()
    {
        RuleFor(x => x.CategoryId).GreaterThan(0).WithMessage("Category ID is required.");
        RuleFor(x => x.Request.CategoryName).ValidCategoryName();
    }
}
