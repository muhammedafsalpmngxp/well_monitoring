using FluentValidation;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.DataSources;

public sealed class CreateDataSourceValidator : AbstractValidator<CreateDataSourceCommand>
{
    public CreateDataSourceValidator()
    {
        RuleFor(x => x.Request.ConnectionName)
            .NotEmpty().WithMessage("ConnectionName is required.")
            .MaximumLength(200).WithMessage("ConnectionName must not exceed 200 characters.");

        RuleFor(x => x.Request.Kind)
            .NotEmpty().WithMessage("Kind is required.")
            .Must(DataSourceKinds.IsSupported)
            .WithMessage($"Kind must be one of: {string.Join(", ", DataSourceKinds.All)}.");

        RuleFor(x => x.Request.AuthType)
            .NotEmpty().WithMessage("AuthType is required.")
            .Must(DataSourceAuthTypes.IsSupported)
            .WithMessage($"AuthType must be one of: {string.Join(", ", DataSourceAuthTypes.All)}.");

        // A REST source is useless without a URL, and failing here gives a clearer message
        // than the connector's runtime check would.
        RuleFor(x => x.Request)
            .Must(r => r.Config is not null
                    && r.Config.TryGetValue("url", out var url)
                    && !string.IsNullOrWhiteSpace(url?.ToString()))
            .When(x => string.Equals(x.Request.Kind, DataSourceKinds.RestApi, StringComparison.OrdinalIgnoreCase))
            .WithMessage("A REST API data source requires a 'url' in Config.");

        RuleFor(x => x.Request)
            .Must(r => r.Config is not null
                    && r.Config.TryGetValue("spreadsheetId", out var id)
                    && !string.IsNullOrWhiteSpace(id?.ToString()))
            .When(x => string.Equals(x.Request.Kind, DataSourceKinds.GoogleSheets, StringComparison.OrdinalIgnoreCase))
            .WithMessage("A Google Sheets data source requires a 'spreadsheetId' in Config.");
    }
}

public sealed class UpdateDataSourceValidator : AbstractValidator<UpdateDataSourceCommand>
{
    public UpdateDataSourceValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0).WithMessage("Data source ID must be a positive number.");

        RuleFor(x => x.Request.ConnectionName)
            .NotEmpty().WithMessage("ConnectionName is required.")
            .MaximumLength(200).WithMessage("ConnectionName must not exceed 200 characters.");

        RuleFor(x => x.Request.AuthType)
            .NotEmpty().WithMessage("AuthType is required.")
            .Must(DataSourceAuthTypes.IsSupported)
            .WithMessage($"AuthType must be one of: {string.Join(", ", DataSourceAuthTypes.All)}.");
    }
}

public sealed class IngestDataSourceValidator : AbstractValidator<IngestDataSourceCommand>
{
    public IngestDataSourceValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0).WithMessage("Data source ID must be a positive number.");

        RuleFor(x => x.Request.DatasetName)
            .MaximumLength(200).WithMessage("DatasetName must not exceed 200 characters.")
            .When(x => !string.IsNullOrWhiteSpace(x.Request.DatasetName));
    }
}
