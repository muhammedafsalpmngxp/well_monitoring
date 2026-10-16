using FluentValidation;

namespace TWise.Tenant.Application.Features.CrewAssignments;

public sealed class CreateCrewAssignmentValidator : AbstractValidator<CreateCrewAssignmentCommand>
{
    public CreateCrewAssignmentValidator()
    {
        RuleFor(x => x.Request.CrewGroupCode).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Request.CrewUid).NotEmpty().MaximumLength(128);
        RuleFor(x => x.Request.CrewTypeCode).MaximumLength(50);
        RuleFor(x => x.Request.ActivityCode).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Request.ActivityName).NotEmpty().MaximumLength(500);
        RuleFor(x => x.Request.WellId).MaximumLength(50);
        RuleFor(x => x.Request.ProjectId).MaximumLength(64);
        RuleFor(x => x.Request.PlannedEnd)
            .GreaterThanOrEqualTo(x => x.Request.PlannedStart!.Value)
            .When(x => x.Request.PlannedStart.HasValue && x.Request.PlannedEnd.HasValue)
            .WithMessage("PlannedEnd must be on or after PlannedStart.");
    }
}
