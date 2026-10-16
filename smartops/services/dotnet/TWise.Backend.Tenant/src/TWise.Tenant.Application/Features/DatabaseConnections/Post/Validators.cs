using FluentValidation;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public sealed class CreateDatabaseConnectionValidator : AbstractValidator<CreateDatabaseConnectionCommand>
{
    /// <summary>Engines with an ISqlDialectProvider implementation.</summary>
    private static readonly string[] SupportedProviders = ["mssql", "postgres", "mysql", "mariadb", "redshift", "clickhouse", "trino"];

    public CreateDatabaseConnectionValidator()
    {
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

        // Trino / Presto clusters commonly run without authentication over plain HTTP.
        RuleFor(x => x.Request.Password)
            .NotEmpty().WithMessage("Password is required.")
            .When(x => x.Request.Provider != "trino");

        RuleFor(x => x.Request.Provider)
            .NotEmpty().WithMessage("Provider is required.")
            .Must(v => SupportedProviders.Contains(v, StringComparer.OrdinalIgnoreCase))
            .WithMessage($"Provider must be one of: {string.Join(", ", SupportedProviders)}.");
    }
}
