using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.DatasetPrompts;

public sealed class SaveAiDatasetPromptCommandValidator : AbstractValidator<SaveAiDatasetPromptCommand>
{
    public SaveAiDatasetPromptCommandValidator()
    {
        RuleFor(x => x.SourceType).Must(t => t is "view" or "import").WithMessage("sourceType must be view or import.");
        RuleFor(x => x.Key).Must(k => AiPrompts.DatasetKeys.Contains(k))
            .WithMessage($"Key must be one of: {string.Join(", ", AiPrompts.DatasetKeys)}.");
        RuleFor(x => x.Text).MaximumLength(AiPrompts.MaxLength).WithMessage($"Keep the text under {AiPrompts.MaxLength} characters.");
    }
}
