using FluentValidation;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public sealed class CreateUserValidator : AbstractValidator<CreateUserCommand>
{
    public CreateUserValidator()
    {
        // Optional (SSO users have none); when set it must meet the policy PasswordHelper enforces on reset.
        RuleFor(x => x.Request.Password)
            .Must(p => string.IsNullOrEmpty(p) || PasswordPolicy.Check(p) is null)
            .WithMessage(x => PasswordPolicy.Check(x.Request.Password) ?? "");

        RuleFor(x => x.Request.Email)
            .NotEmpty().WithMessage("Email is required.")
            .MaximumLength(160).WithMessage("Email must not exceed 160 characters.")
            .EmailAddress().WithMessage("Email must be a valid email address.");

        RuleFor(x => x.Request.DisplayName)
            .MaximumLength(100).WithMessage("DisplayName must not exceed 100 characters.");

        RuleFor(x => x.Request.Status)
            .MaximumLength(20).WithMessage("Status must not exceed 20 characters.");
    }
}

public sealed class CreateRoleValidator : AbstractValidator<CreateRoleCommand>
{
    public CreateRoleValidator()
    {
        RuleFor(x => x.Request.RoleCode)
            .NotEmpty().WithMessage("RoleCode is required.")
            .MaximumLength(40).WithMessage("RoleCode must not exceed 40 characters.");

        RuleFor(x => x.Request.RoleName)
            .MaximumLength(100).WithMessage("RoleName must not exceed 100 characters.");

        RuleFor(x => x.Request.Description)
            .MaximumLength(500).WithMessage("Description must not exceed 500 characters.");

        RuleFor(x => x.Request.Scope)
            .Must(v => v is null or "platform" or "tenant")
            .WithMessage("Scope must be one of: platform, tenant.");

        RuleFor(x => x.Request.Scope)
            .Must((cmd, scope) => scope != "platform" || cmd.CallerTenantId == 0)
            .WithMessage("Tenant admins cannot create platform-scoped roles.");
    }
}

public sealed class CreateUserTenantRoleValidator : AbstractValidator<CreateUserTenantRoleCommand>
{
    public CreateUserTenantRoleValidator()
    {
        RuleFor(x => x.Request.UserId)
            .GreaterThan(0).WithMessage("UserId is required.");

        RuleFor(x => x.Request.TenantId)
            .GreaterThan(0).WithMessage("TenantId is required.");

        RuleFor(x => x.Request.RoleId)
            .GreaterThan(0).WithMessage("RoleId is required.");
    }
}

public sealed class CreateFeatureValidator : AbstractValidator<CreateFeatureCommand>
{
    public CreateFeatureValidator()
    {
        RuleFor(x => x.Request.FeatureCode)
            .NotEmpty().WithMessage("FeatureCode is required.")
            .MaximumLength(40).WithMessage("FeatureCode must not exceed 40 characters.");

        RuleFor(x => x.Request.FeatureName)
            .MaximumLength(100).WithMessage("FeatureName must not exceed 100 characters.");
    }
}

public sealed class CreateTenantFeatureValidator : AbstractValidator<CreateTenantFeatureCommand>
{
    public CreateTenantFeatureValidator()
    {
        RuleFor(x => x.Request.TenantId)
            .GreaterThan(0).WithMessage("TenantId is required.");

        RuleFor(x => x.Request.FeatureId)
            .GreaterThan(0).WithMessage("FeatureId is required.");
    }
}

public sealed class CreateModuleValidator : AbstractValidator<CreateModuleCommand>
{
    public CreateModuleValidator()
    {
        RuleFor(x => x.Request.ModuleCode)
            .NotEmpty().WithMessage("ModuleCode is required.")
            .MaximumLength(80).WithMessage("ModuleCode must not exceed 80 characters.");

        RuleFor(x => x.Request.ParentCode)
            .MaximumLength(80).WithMessage("ParentCode must not exceed 80 characters.");

        RuleFor(x => x.Request.DisplayName)
            .MaximumLength(100).WithMessage("DisplayName must not exceed 100 characters.");

        RuleFor(x => x.Request.FeatureCode)
            .MaximumLength(40).WithMessage("FeatureCode must not exceed 40 characters.");
    }
}
