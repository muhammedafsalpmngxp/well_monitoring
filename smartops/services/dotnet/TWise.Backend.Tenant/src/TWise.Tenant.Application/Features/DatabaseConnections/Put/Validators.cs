using FluentValidation;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public sealed class UpdateDatabaseConnectionValidator : AbstractValidator<UpdateDatabaseConnectionCommand>
{
    public UpdateDatabaseConnectionValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0).WithMessage("Connection ID must be a positive number.");

        RuleFor(x => x.Request.ConnectionName)
            .NotEmpty().WithMessage("ConnectionName is required.")
            .MaximumLength(100).WithMessage("ConnectionName must not exceed 100 characters.");

        RuleFor(x => x.Request.Server)
            .NotEmpty().WithMessage("Server is required.")
            .MaximumLength(200).WithMessage("Server must not exceed 200 characters.");

        RuleFor(x => x.Request.Port)
            .InclusiveBetween(1, 65535).WithMessage("Port must be between 1 and 65535.");

        RuleFor(x => x.Request.DatabaseName)
            .NotEmpty().WithMessage("DatabaseName is required.")
            .MaximumLength(128).WithMessage("DatabaseName must not exceed 128 characters.");

        RuleFor(x => x.Request.Username)
            .NotEmpty().WithMessage("Username is required.")
            .MaximumLength(128).WithMessage("Username must not exceed 128 characters.");

        RuleFor(x => x.Request.Password)
            .MaximumLength(256).WithMessage("Password must not exceed 256 characters.")
            .When(x => !string.IsNullOrWhiteSpace(x.Request.Password));

        RuleFor(x => x.Request.Provider)
            .NotEmpty().WithMessage("Provider is required.")
            .Must(v => v is "mssql" or "postgres" or "mysql" or "mariadb" or "redshift" or "clickhouse" or "trino")
            .WithMessage("Provider must be one of: mssql, postgres, mysql, mariadb, redshift, clickhouse, trino.");
    }
}
