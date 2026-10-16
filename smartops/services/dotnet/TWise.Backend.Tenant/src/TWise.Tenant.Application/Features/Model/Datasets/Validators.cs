using System.Text.RegularExpressions;
using FluentValidation;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public static class DatasetValidationRules
{
    // Request fields are written alias.column, and model.DatasetSource refuses a dot in an alias.
    private static readonly Regex AliasPattern = new("^[A-Za-z_][A-Za-z0-9_]{0,63}$", RegexOptions.Compiled);

    public static IRuleBuilderOptions<T, string> ItemName<T>(this IRuleBuilder<T, string> rule) => rule
        .Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Enter a name.")
        .Must(n => n is null || n.Trim().Length <= 128).WithMessage("A name must be 128 characters or fewer.");

    public static IRuleBuilderOptions<T, string> SourceAlias<T>(this IRuleBuilder<T, string> rule) => rule
        .Must(a => a is not null && AliasPattern.IsMatch(a))
        .WithMessage("A table name in a data model uses letters, digits and underscores, does not start with a digit, and is at most 64 characters.");

    // Exact lower case: the model schema compares these with a binary collation.
    public static IRuleBuilderOptions<T, string> RlsMode<T>(this IRuleBuilder<T, string> rule) => rule
        .Must(m => m is "plant" or "none").WithMessage("Choose who sees which rows: by plant, or everyone.");

    public static IRuleBuilderOptions<T, string> Cardinality<T>(this IRuleBuilder<T, string> rule) => rule
        .Must(c => c is "many_to_one" or "one_to_one").WithMessage("Cardinality must be many_to_one or one_to_one.");
}

public sealed class CreateDatasetCommandValidator : AbstractValidator<CreateDatasetCommand>
{
    public CreateDatasetCommandValidator()
    {
        RuleFor(x => x.Request.Name).ItemName();
        RuleFor(x => x.Request.Description).MaximumLength(500).WithMessage("A description must be 500 characters or fewer.");
        RuleFor(x => x.Request.ConnectionId).GreaterThan(0).WithMessage("Choose a connection.");
    }
}

public sealed class UpdateDatasetCommandValidator : AbstractValidator<UpdateDatasetCommand>
{
    public UpdateDatasetCommandValidator()
    {
        RuleFor(x => x.Request.Name).ItemName();
        RuleFor(x => x.Request.Description).MaximumLength(500).WithMessage("A description must be 500 characters or fewer.");
    }
}

public sealed class AddSourceCommandValidator : AbstractValidator<AddSourceCommand>
{
    public AddSourceCommandValidator()
    {
        RuleFor(x => x.Request.SchemaName).NotEmpty().MaximumLength(128);
        RuleFor(x => x.Request.SourceName).NotEmpty().MaximumLength(128);
        RuleFor(x => x.Request.Alias).SourceAlias();
        RuleFor(x => x.Request.RlsMode).RlsMode();
        RuleFor(x => x.Request.RlsPlantColumn).NotEmpty().When(x => x.Request.RlsMode == "plant")
            .WithMessage("Choose the column that holds the plant code.");
        RuleFor(x => x.Request.Kind).Must(k => k is "table" or "view" or ScriptSource.Kind).WithMessage("Choose a table or a view.");
        RuleFor(x => x.Request.SourceName).Matches("^[0-9]{1,18}$").When(x => x.Request.Kind is "view" or ScriptSource.Kind)
            .WithMessage("Choose a view.");
    }
}

public sealed class SetSourceParametersCommandValidator : AbstractValidator<SetSourceParametersCommand>
{
    public SetSourceParametersCommandValidator()
    {
        RuleFor(x => x.Request).Cascade(CascadeMode.Stop).NotNull().WithMessage("Send the list of variables and the fields they are bound to.")
            .Must(r => r.Count <= 50).WithMessage("Send at most 50 variables.");
        RuleForEach(x => x.Request).Must(b => b is not null && !string.IsNullOrWhiteSpace(b.Name)).WithMessage("Name each variable, for example @plant.");
    }
}

public sealed class SetSourceDetailsCommandValidator : AbstractValidator<SetSourceDetailsCommand>
{
    public SetSourceDetailsCommandValidator()
    {
        RuleFor(x => x.Request.Caption).MaximumLength(80).WithMessage("A table name has at most 80 characters.");
        RuleFor(x => x.Request.Description).MaximumLength(500).WithMessage("A table description has at most 500 characters.");
    }
}

public sealed class UpdateSourceCommandValidator : AbstractValidator<UpdateSourceCommand>
{
    public UpdateSourceCommandValidator()
    {
        RuleFor(x => x.Request.RlsMode).RlsMode();
        RuleFor(x => x.Request.RlsPlantColumn).NotEmpty().When(x => x.Request.RlsMode == "plant")
            .WithMessage("Choose the column that holds the plant code.");
    }
}

public sealed class AddRelationshipCommandValidator : AbstractValidator<AddRelationshipCommand>
{
    public AddRelationshipCommandValidator()
    {
        RuleFor(x => x.Request.FromColumn).NotEmpty();
        RuleFor(x => x.Request.ToColumn).NotEmpty();
        RuleFor(x => x.Request.Cardinality).Cardinality();
        RuleFor(x => x.Request.DetectedFrom).Must(d => d is "fk" or "user").WithMessage("DetectedFrom must be fk or user.");
        RuleFor(x => x.Request).Must(r => r.FromSourceId != r.ToSourceId).WithMessage("A table cannot be related to itself.");
    }
}

public sealed class UpdateRelationshipCommandValidator : AbstractValidator<UpdateRelationshipCommand>
{
    public UpdateRelationshipCommandValidator() => RuleFor(x => x.Request.Cardinality).Cardinality();
}

public sealed class AddMeasureCommandValidator : AbstractValidator<AddMeasureCommand>
{
    public AddMeasureCommandValidator()
    {
        RuleFor(x => x.Request.Name).ItemName();
    }
}

public sealed class UpdateMeasureCommandValidator : AbstractValidator<UpdateMeasureCommand>
{
    public UpdateMeasureCommandValidator()
    {
        RuleFor(x => x.Request.Name).ItemName();
    }
}

public sealed class AddCalculatedColumnCommandValidator : AbstractValidator<AddCalculatedColumnCommand>
{
    public AddCalculatedColumnCommandValidator()
    {
        RuleFor(x => x.Request.SourceId).GreaterThan(0).WithMessage("Choose the table the column belongs to.");
        RuleFor(x => x.Request.Name).ItemName();
    }
}

public sealed class UpdateCalculatedColumnCommandValidator : AbstractValidator<UpdateCalculatedColumnCommand>
{
    public UpdateCalculatedColumnCommandValidator() => RuleFor(x => x.Request.Name).ItemName();
}

public sealed class AddTransformCommandValidator : AbstractValidator<AddTransformCommand>
{
    private static readonly string[] RemoveTests =
        ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with", "ends_with", "blank", "not_blank"];

    private static readonly string[] OptionKeys = ["with", "match", "style", "op"];

    public AddTransformCommandValidator()
    {
        RuleFor(x => x.Request.SourceId).GreaterThan(0).WithMessage("Choose the table the transform belongs to.");
        RuleFor(x => x.Request.Column).NotEmpty().WithMessage("Choose a column.").MaximumLength(128);
        // Exact lower case: the model schema compares Kind with a binary collation (script 006 allows these).
        RuleFor(x => x.Request.Kind).Must(k => k is "trim" or "null_fill" or "replace" or "type" or "remove_rows")
            .WithMessage("Choose a transform: remove spaces, fill blank cells, replace values, change the type or remove rows.");
        RuleFor(x => x.Request.Value).NotNull().When(x => x.Request.Kind == "null_fill")
            .WithMessage("Enter the value that fills blank cells.");
        RuleFor(x => x.Request.Value).MaximumLength(4000).WithMessage("A value must be 4000 characters or fewer.");

        RuleFor(x => x.Request.Value).NotEmpty().When(x => x.Request.Kind == "replace").WithMessage("Enter the text to replace.");
        RuleFor(x => x.Request.Options).Must(o => o is not null && o.ContainsKey("with")).When(x => x.Request.Kind == "replace")
            .WithMessage("Enter what replaces it. It can be empty.");
        RuleFor(x => x.Request.Options).Must(o => o is null || !o.TryGetValue("match", out var match) || match is "part" or "whole")
            .WithMessage("Replace part of a value or the whole value.");

        RuleFor(x => x.Request.Value).Must(v => v is "number" or "date" or "text").When(x => x.Request.Kind == "type")
            .WithMessage("Choose the new type: number, date or text.");
        RuleFor(x => x.Request.Options).Must(o => o is null || !o.TryGetValue("style", out var style) || style is "iso" or "dmy" or "mdy")
            .WithMessage("Choose how the dates are written: year first, day first or month first.");

        RuleFor(x => x.Request.Options).Must(o => o is not null && o.TryGetValue("op", out var op) && RemoveTests.Contains(op))
            .When(x => x.Request.Kind == "remove_rows").WithMessage("Choose which rows to remove.");
        RuleFor(x => x.Request.Value).NotNull()
            .When(x => x.Request.Kind == "remove_rows" && x.Request.Options?.GetValueOrDefault("op") is not ("blank" or "not_blank"))
            .WithMessage("Enter the value to compare with.");
        // An empty value would match every row that is not blank. A space is allowed; a missing value is refused above.
        RuleFor(x => x.Request.Value).Must(v => v is not "")
            .When(x => x.Request.Kind == "remove_rows" && x.Request.Options?.GetValueOrDefault("op") is "contains" or "starts_with" or "ends_with")
            .WithMessage("Enter the text to look for.");

        RuleFor(x => x.Request.Options).Must(o => o is null || o.All(p => OptionKeys.Contains(p.Key) && p.Value is { Length: <= 4000 }))
            .WithMessage("A transform setting is not known, or is longer than 4000 characters.");
    }
}
