using FluentValidation;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public sealed class CreateSourceSystemValidator : AbstractValidator<CreateSourceSystemCommand>
{
    public CreateSourceSystemValidator()
    {
        RuleFor(x => x.Request.SourceCode)
            .NotEmpty().WithMessage("SourceCode is required.")
            .MaximumLength(20).WithMessage("SourceCode must not exceed 20 characters.");

        RuleFor(x => x.Request.SourceName)
            .MaximumLength(100).WithMessage("SourceName must not exceed 100 characters.");

        RuleFor(x => x.Request.SourceKind)
            .MaximumLength(50).WithMessage("SourceKind must not exceed 50 characters.");
    }
}

public sealed class CreateTenantSourceValidator : AbstractValidator<CreateTenantSourceCommand>
{
    public CreateTenantSourceValidator()
    {
        RuleFor(x => x.Request.TenantId)
            .GreaterThan(0).WithMessage("TenantId is required.");

        RuleFor(x => x.Request.SourceSystemId)
            .GreaterThan(0).WithMessage("SourceSystemId is required.");

        RuleFor(x => x.Request.ConnectionRef)
            .MaximumLength(200).WithMessage("ConnectionRef must not exceed 200 characters.");

        RuleFor(x => x.Request.IngestionMode)
            .Must(v => v is null or "one_time" or "continuous")
            .WithMessage("IngestionMode must be one of: one_time, continuous.");
    }
}

public sealed class CreateCanonicalEntityValidator : AbstractValidator<CreateCanonicalEntityCommand>
{
    public CreateCanonicalEntityValidator()
    {
        RuleFor(x => x.Request.EntityName)
            .NotEmpty().WithMessage("EntityName is required.")
            .MaximumLength(100).WithMessage("EntityName must not exceed 100 characters.");

        RuleFor(x => x.Request.Layer)
            .Must(v => v is null or "ref" or "core")
            .WithMessage("Layer must be one of: ref, core.");

        RuleFor(x => x.Request.Description)
            .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
    }
}

public sealed class CreateCanonicalFieldValidator : AbstractValidator<CreateCanonicalFieldCommand>
{
    public CreateCanonicalFieldValidator()
    {
        RuleFor(x => x.Request.CanonicalEntityId)
            .GreaterThan(0).WithMessage("CanonicalEntityId is required.");

        RuleFor(x => x.Request.FieldName)
            .NotEmpty().WithMessage("FieldName is required.")
            .MaximumLength(100).WithMessage("FieldName must not exceed 100 characters.");

        RuleFor(x => x.Request.DataType)
            .MaximumLength(50).WithMessage("DataType must not exceed 50 characters.");

        RuleFor(x => x.Request.Description)
            .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
    }
}

public sealed class CreateFieldMappingValidator : AbstractValidator<CreateFieldMappingCommand>
{
    public CreateFieldMappingValidator()
    {
        RuleFor(x => x.Request.TenantSourceId)
            .GreaterThan(0).WithMessage("TenantSourceId is required.");

        RuleFor(x => x.Request.CanonicalFieldId)
            .GreaterThan(0).WithMessage("CanonicalFieldId is required.");

        RuleFor(x => x.Request.SourceObject)
            .MaximumLength(128).WithMessage("SourceObject must not exceed 128 characters.");

        RuleFor(x => x.Request.SourceField)
            .MaximumLength(128).WithMessage("SourceField must not exceed 128 characters.");
    }
}

public sealed class CreateCapabilityProfileValidator : AbstractValidator<CreateCapabilityProfileCommand>
{
    public CreateCapabilityProfileValidator()
    {
        RuleFor(x => x.Request.TenantSourceId)
            .GreaterThan(0).WithMessage("TenantSourceId is required.");

        RuleFor(x => x.Request.CanonicalFieldId)
            .GreaterThan(0).WithMessage("CanonicalFieldId is required.");

        RuleFor(x => x.Request.Note)
            .MaximumLength(200).WithMessage("Note must not exceed 200 characters.");
    }
}

// Bulk create validators
public sealed class BulkCreateCanonicalEntitiesValidator : AbstractValidator<BulkCreateCanonicalEntitiesCommand>
{
    public BulkCreateCanonicalEntitiesValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Items list must not be empty.")
            .Must(items => items.Count <= 100).WithMessage("Cannot exceed 100 items per batch.");

        RuleForEach(x => x.Request.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.EntityName)
                .NotEmpty().WithMessage("EntityName is required.")
                .MaximumLength(100).WithMessage("EntityName must not exceed 100 characters.");

            item.RuleFor(x => x.Layer)
                .Must(v => v is null or "ref" or "core")
                .WithMessage("Layer must be one of: ref, core.");

            item.RuleFor(x => x.Description)
                .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
        });
    }
}

public sealed class BulkCreateCanonicalFieldsValidator : AbstractValidator<BulkCreateCanonicalFieldsCommand>
{
    public BulkCreateCanonicalFieldsValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Items list must not be empty.")
            .Must(items => items.Count <= 100).WithMessage("Cannot exceed 100 items per batch.");

        RuleForEach(x => x.Request.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.CanonicalEntityId)
                .GreaterThan(0).WithMessage("CanonicalEntityId is required.");

            item.RuleFor(x => x.FieldName)
                .NotEmpty().WithMessage("FieldName is required.")
                .MaximumLength(100).WithMessage("FieldName must not exceed 100 characters.");

            item.RuleFor(x => x.DataType)
                .MaximumLength(50).WithMessage("DataType must not exceed 50 characters.");

            item.RuleFor(x => x.Description)
                .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
        });
    }
}

public sealed class BulkCreateFieldMappingsValidator : AbstractValidator<BulkCreateFieldMappingsCommand>
{
    public BulkCreateFieldMappingsValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Items list must not be empty.")
            .Must(items => items.Count <= 100).WithMessage("Cannot exceed 100 items per batch.");

        RuleForEach(x => x.Request.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.TenantSourceId)
                .GreaterThan(0).WithMessage("TenantSourceId is required.");

            item.RuleFor(x => x.CanonicalFieldId)
                .GreaterThan(0).WithMessage("CanonicalFieldId is required.");

            item.RuleFor(x => x.SourceObject)
                .MaximumLength(128).WithMessage("SourceObject must not exceed 128 characters.");

            item.RuleFor(x => x.SourceField)
                .MaximumLength(128).WithMessage("SourceField must not exceed 128 characters.");
        });
    }
}

// Bulk update validators
public sealed class BulkUpdateCanonicalEntitiesValidator : AbstractValidator<BulkUpdateCanonicalEntitiesCommand>
{
    public BulkUpdateCanonicalEntitiesValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Items list must not be empty.")
            .Must(items => items.Count <= 100).WithMessage("Cannot exceed 100 items per batch.");

        RuleForEach(x => x.Request.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.CanonicalEntityId)
                .GreaterThan(0).WithMessage("CanonicalEntityId is required.");

            item.RuleFor(x => x.EntityName)
                .NotEmpty().WithMessage("EntityName is required.")
                .MaximumLength(100).WithMessage("EntityName must not exceed 100 characters.");

            item.RuleFor(x => x.Layer)
                .Must(v => v is null or "ref" or "core")
                .WithMessage("Layer must be one of: ref, core.");

            item.RuleFor(x => x.Description)
                .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
        });
    }
}

public sealed class BulkUpdateCanonicalFieldsValidator : AbstractValidator<BulkUpdateCanonicalFieldsCommand>
{
    public BulkUpdateCanonicalFieldsValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Items list must not be empty.")
            .Must(items => items.Count <= 100).WithMessage("Cannot exceed 100 items per batch.");

        RuleForEach(x => x.Request.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.CanonicalFieldId)
                .GreaterThan(0).WithMessage("CanonicalFieldId is required.");

            item.RuleFor(x => x.CanonicalEntityId)
                .GreaterThan(0).WithMessage("CanonicalEntityId is required.");

            item.RuleFor(x => x.FieldName)
                .NotEmpty().WithMessage("FieldName is required.")
                .MaximumLength(100).WithMessage("FieldName must not exceed 100 characters.");

            item.RuleFor(x => x.DataType)
                .MaximumLength(50).WithMessage("DataType must not exceed 50 characters.");

            item.RuleFor(x => x.Description)
                .MaximumLength(200).WithMessage("Description must not exceed 200 characters.");
        });
    }
}

public sealed class BulkUpdateFieldMappingsValidator : AbstractValidator<BulkUpdateFieldMappingsCommand>
{
    public BulkUpdateFieldMappingsValidator()
    {
        RuleFor(x => x.Request.Items)
            .NotEmpty().WithMessage("Items list must not be empty.")
            .Must(items => items.Count <= 100).WithMessage("Cannot exceed 100 items per batch.");

        RuleForEach(x => x.Request.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.FieldMappingId)
                .GreaterThan(0).WithMessage("FieldMappingId is required.");

            item.RuleFor(x => x.TenantSourceId)
                .GreaterThan(0).WithMessage("TenantSourceId is required.");

            item.RuleFor(x => x.CanonicalFieldId)
                .GreaterThan(0).WithMessage("CanonicalFieldId is required.");

            item.RuleFor(x => x.SourceObject)
                .MaximumLength(128).WithMessage("SourceObject must not exceed 128 characters.");

            item.RuleFor(x => x.SourceField)
                .MaximumLength(128).WithMessage("SourceField must not exceed 128 characters.");
        });
    }
}
