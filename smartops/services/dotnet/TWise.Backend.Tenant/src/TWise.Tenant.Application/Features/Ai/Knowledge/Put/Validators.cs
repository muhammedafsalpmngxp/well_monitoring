using FluentValidation;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed class SaveAiDatasetNotesCommandValidator : AbstractValidator<SaveAiDatasetNotesCommand>
{
    public SaveAiDatasetNotesCommandValidator() => RuleFor(x => x.SourceType).Must(AiSources.IsSourceType).WithMessage(AiSources.Message);
}

public sealed class SaveAiDatasetMetricsCommandValidator : AbstractValidator<SaveAiDatasetMetricsCommand>
{
    public SaveAiDatasetMetricsCommandValidator()
    {
        RuleFor(x => x.SourceType).Must(AiSources.IsSourceType).WithMessage(AiSources.Message);
        RuleFor(x => x.Metrics).Custom((metrics, ctx) =>
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in metrics ?? [])
            {
                var name = (m.Name ?? "").Trim();
                if (name.Length is 0 or > 100) { ctx.AddFailure("Each metric needs a name of up to 100 characters."); return; }
                var agg = AiKnowledgeRules.Aggregations.FirstOrDefault(a => string.Equals(a, m.Agg?.Trim(), StringComparison.OrdinalIgnoreCase));
                if (agg is null) { ctx.AddFailure($"Metric '{name}': agg must be one of {string.Join(", ", AiKnowledgeRules.Aggregations)}."); return; }
                if (string.IsNullOrWhiteSpace(m.Column) && agg != "count") { ctx.AddFailure($"Metric '{name}': a column is required for {agg}."); return; }
                if (!seen.Add(name)) { ctx.AddFailure($"Metric '{name}' is listed twice."); return; }
            }
        });
    }
}

public sealed class SaveAiDatasetTermsCommandValidator : AbstractValidator<SaveAiDatasetTermsCommand>
{
    public SaveAiDatasetTermsCommandValidator()
    {
        RuleFor(x => x.SourceType).Must(AiSources.IsSourceType).WithMessage(AiSources.Message);
        RuleFor(x => x.Terms).Custom((terms, ctx) =>
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in terms ?? [])
            {
                var term = AiKnowledgeRules.Clean(t.Term, 100);
                if (term is null) continue;
                foreach (var word in AiKnowledgeRules.Synonyms(t.Synonyms).Prepend(term))
                    if (!seen.Add(word)) { ctx.AddFailure($"'{word}' is used by more than one term."); return; }
                var column = AiKnowledgeRules.Clean(t.Column, 200);
                var value = AiKnowledgeRules.Clean(t.Value, 400);
                var meaning = AiKnowledgeRules.Clean(t.Meaning, 500);
                if ((column is null) != (value is null)) { ctx.AddFailure($"Term '{term}': give both a column and a value, or neither."); return; }
                if (column is null && meaning is null) { ctx.AddFailure($"Term '{term}': give a column and value, or a meaning."); return; }
            }
        });
    }
}

public sealed class SetAiExampleStatusCommandValidator : AbstractValidator<SetAiExampleStatusCommand>
{
    public SetAiExampleStatusCommandValidator() =>
        RuleFor(x => x.Status).Must(s => s is AiExampleStatus.Approved or AiExampleStatus.Rejected).WithMessage("status must be approved or rejected.");
}
