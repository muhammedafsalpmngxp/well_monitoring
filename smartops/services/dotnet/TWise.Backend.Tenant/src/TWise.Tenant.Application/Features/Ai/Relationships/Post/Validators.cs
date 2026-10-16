using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

public sealed class DetectAiRelationsCommandValidator : AbstractValidator<DetectAiRelationsCommand>
{
    public DetectAiRelationsCommandValidator()
    {
        RuleForEach(x => x.Datasets).Must(k => k.StartsWith("view:") || k.StartsWith("import:")).WithMessage("Datasets are view:<id> or import:<id>.");
        RuleFor(x => x.Datasets).Must(d => d is null || d.Count <= DatasetRelations.MaxDatasetsPerScan)
            .WithMessage($"Scan at most {DatasetRelations.MaxDatasetsPerScan} datasets at a time.");
    }
}

public sealed class AddAiRelationCommandValidator : AbstractValidator<AddAiRelationCommand>
{
    public AddAiRelationCommandValidator()
    {
        RuleFor(x => x.Request.FromType).Must(t => t is "view" or "import").WithMessage("fromType must be view or import.");
        RuleFor(x => x.Request.ToType).Must(t => t is "view" or "import").WithMessage("toType must be view or import.");
        RuleFor(x => x.Request.FromColumn).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Request.ToColumn).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Request).Must(r => !(r.FromType == r.ToType && r.FromId == r.ToId)).WithMessage("A dataset cannot be linked to itself.");
    }
}
