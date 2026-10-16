using FluentValidation;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public sealed class CreateRegionValidator : AbstractValidator<CreateRegionCommand>
{
    public CreateRegionValidator()
    {
        RuleFor(x => x.Request.RegionCode)
            .NotEmpty().WithMessage("RegionCode is required.")
            .MaximumLength(20).WithMessage("RegionCode must not exceed 20 characters.");

        RuleFor(x => x.Request.RegionName)
            .MaximumLength(100).WithMessage("RegionName must not exceed 100 characters.");
    }
}

public sealed class CreateSchemaVersionValidator : AbstractValidator<CreateSchemaVersionCommand>
{
    public CreateSchemaVersionValidator()
    {
        RuleFor(x => x.Request.VersionNo)
            .NotEmpty().WithMessage("VersionNo is required.")
            .MaximumLength(20).WithMessage("VersionNo must not exceed 20 characters.");

        RuleFor(x => x.Request.Description)
            .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
    }
}

public sealed class CreateTenantValidator : AbstractValidator<CreateTenantCommand>
{
    public CreateTenantValidator()
    {
        RuleFor(x => x.Request.TenantCode)
            .NotEmpty().WithMessage("TenantCode is required.")
            .MaximumLength(20).WithMessage("TenantCode must not exceed 20 characters.");

        RuleFor(x => x.Request.TenantName)
            .MaximumLength(100).WithMessage("TenantName must not exceed 100 characters.");

        RuleFor(x => x.Request.IsolationMode)
            .Must(v => v is null or "database_per_tenant" or "schema_per_tenant" or "pooled")
            .WithMessage("IsolationMode must be one of: database_per_tenant, schema_per_tenant, pooled.");

        RuleFor(x => x.Request.Status)
            .MaximumLength(20).WithMessage("Status must not exceed 20 characters.");
    }
}
