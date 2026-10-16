using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

public sealed class SetAiRelationStatusCommandValidator : AbstractValidator<SetAiRelationStatusCommand>
{
    public SetAiRelationStatusCommandValidator()
    {
        RuleFor(x => x.Status).Must(DatasetRelations.IsStatus).WithMessage("Status must be suggested, confirmed or rejected.");
    }
}
