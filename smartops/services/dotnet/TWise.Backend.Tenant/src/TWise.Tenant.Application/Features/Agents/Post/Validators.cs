using FluentValidation;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Rules every saved or tested agent must meet.</summary>
public sealed class SaveAiAgentRequestValidator : AbstractValidator<SaveAiAgentRequest>
{
    public static readonly string[] Statuses = ["draft", "published"];
    public static readonly string[] Types = ["sequential", "parallel", "supervisor", "loop"];
    public static readonly string[] RuleOps = ["equals", "not_equals", "contains", "not_contains", "gt", "gte", "lt", "lte", "empty", "not_empty", "else"];

    public SaveAiAgentRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Give the agent a name.").MaximumLength(200);
        RuleFor(x => x.Role).MaximumLength(200);
        RuleFor(x => x.Description).MaximumLength(1000);
        RuleFor(x => x.Goal).MaximumLength(1000);
        RuleFor(x => x.SystemPrompt).MaximumLength(8000);
        RuleFor(x => x.Status).Must(s => Statuses.Contains((s ?? "").Trim().ToLowerInvariant())).WithMessage("Status must be draft or published.");
        RuleFor(x => x.Type).Must(t => Types.Contains((t ?? "").Trim().ToLowerInvariant()))
            .WithMessage("Agent type must be sequential, parallel, supervisor or loop.");
        RuleFor(x => x.MaxIterations).InclusiveBetween(1, 20).WithMessage("Max iterations must be between 1 and 20.");
        RuleFor(x => x.Steps).NotEmpty().WithMessage("Add at least one instruction.").Must(s => s.Count <= 20).WithMessage("An agent can have up to 20 instructions.");
        RuleForEach(x => x.Steps).ChildRules(s =>
        {
            s.RuleFor(x => x.Text).NotEmpty().WithMessage("An instruction is empty.").MaximumLength(2000);
            s.RuleFor(x => x.Id).MaximumLength(64);
            s.RuleFor(x => x.Kind).Must(k => k is "step" or "router").WithMessage("A step is an instruction or a router.");
            s.RuleFor(x => x.RouteBy).Must(r => r is "rules" or "ai").WithMessage("A router routes by rules or by AI.");
            s.RuleFor(x => x.Branches).NotEmpty().When(x => x.Kind == "router").WithMessage("A router needs at least one branch.")
                .Must(b => b is null || b.Count <= 10).WithMessage("A router can have up to 10 branches.");
            s.RuleForEach(x => x.Branches).ChildRules(b =>
            {
                b.RuleFor(x => x.Op).Must(o => RuleOps.Contains(o)).WithMessage("Unknown branch rule.");
                b.RuleFor(x => x.Label).MaximumLength(200);
                b.RuleFor(x => x.Value).MaximumLength(500);
            });
        });
        RuleFor(x => x).Must(RoutesAreValid)
            .WithMessage("Routers and step links work in sequential and loop agents, need step ids, and must point to existing steps.");
        RuleFor(x => x).Custom((r, ctx) =>
        {
            if (CircleAt(r) is { } text)
                ctx.AddFailure("Steps", $"The steps go round in a circle at '{(text.Length <= 40 ? text : text[..40])}'. Point a link forward or to the answer.");
        });
        RuleFor(x => x.Tools).NotEmpty().WithMessage("Add at least one tool.");
        RuleForEach(x => x.Tools).ChildRules(t => t.RuleFor(x => x.Agent).NotEmpty().MaximumLength(100));
        RuleForEach(x => x.Inputs).ChildRules(i => i.RuleFor(x => x.Name).Matches("^[A-Za-z_][A-Za-z0-9_]{0,49}$")
            .WithMessage("Input names use letters, digits and _ (they are used as {{name}} in instructions)."));
        RuleFor(x => x.AskData!.MaxRows).InclusiveBetween(1, 1000).When(x => x.AskData is not null)
            .WithMessage("Ask Data row limit must be between 1 and 1000.");
        RuleForEach(x => x.AskData!.AllowedSchemas).Matches("^[A-Za-z_][A-Za-z0-9_]{0,127}$").When(x => x.AskData is not null)
            .WithMessage("Schema names use letters, digits and _.");
        RuleFor(x => x.AskData!.BusinessRules).MaximumLength(60000).When(x => x.AskData is not null);
        RuleFor(x => x.AskData!.Examples).MaximumLength(30000).When(x => x.AskData is not null);
        RuleFor(x => x.Inputs).Must(i => i is null || i.Select(x => x.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() == i.Count)
            .WithMessage("Input names must be unique.");
    }

    /// <summary>Same checks as the runtime: routing only where steps run in order, and every target exists.</summary>
    private static bool RoutesAreValid(SaveAiAgentRequest r)
    {
        var routed = r.Steps.Where(s => s.Kind == "router" || s.Next is not null).ToList();
        if (routed.Count == 0) return true;
        if ((r.Type ?? "").Trim().ToLowerInvariant() is not ("sequential" or "loop") || routed.Any(s => string.IsNullOrEmpty(s.Id))) return false;
        var ids = r.Steps.Select(s => s.Id).Where(id => id is not null).ToHashSet();
        return r.Steps.SelectMany(s => (s.Branches ?? []).Select(b => b.Target).Append(s.Next))
            .All(t => t is null || t == "answer" || ids.Contains(t));
    }

    /// <summary>
    /// The text of a step the links lead back to, or null. Same walk as the runtime's _check_no_cycle (graph.py):
    /// within one run (or one loop round) a step is reached at most once; unknown targets end the path.
    /// </summary>
    private static string? CircleAt(SaveAiAgentRequest r)
    {
        if ((r.Type ?? "").Trim().ToLowerInvariant() is not ("sequential" or "loop") || r.Steps.Count == 0) return null;
        var index = r.Steps.Select((s, i) => (s.Id, i)).Where(p => !string.IsNullOrEmpty(p.Id))
            .GroupBy(p => p.Id!).ToDictionary(g => g.Key, g => g.First().i);
        int? To(string? target) => target is null || target == "answer" ? null : index.TryGetValue(target, out var i) ? i : null;
        IEnumerable<int?> Next(int i)
        {
            var s = r.Steps[i];
            if (s.Kind == "router") return (s.Branches ?? []).Select(b => To(b.Target));
            if (s.Next is not null) return [To(s.Next)];
            return [i + 1 < r.Steps.Count ? i + 1 : null];
        }

        var state = new int[r.Steps.Count];   // 1 = on the current path, 2 = done
        string? Visit(int i)
        {
            if (state[i] == 2) return null;
            if (state[i] == 1) return r.Steps[i].Text;
            state[i] = 1;
            foreach (var n in Next(i))
                if (n is { } m && Visit(m) is { } hit) return hit;
            state[i] = 2;
            return null;
        }
        return Visit(0);
    }
}

public sealed class ExportAskDataQueryValidator : AbstractValidator<ExportAskDataQuery>
{
    public ExportAskDataQueryValidator()
    {
        RuleFor(x => x.Request.Token).NotEmpty().WithMessage("The answer has no data to export.").MaximumLength(20000);
        RuleFor(x => x.Request.Format).Must(f => f is "xlsx" or "docx").WithMessage("Format must be xlsx or docx.");
        RuleFor(x => x.Request.Question).MaximumLength(2000);
        RuleFor(x => x.Request.Answer).MaximumLength(20000);
    }
}

public sealed class CreateAiAgentCommandValidator : AbstractValidator<CreateAiAgentCommand>
{
    public CreateAiAgentCommandValidator() => RuleFor(x => x.Request).SetValidator(new SaveAiAgentRequestValidator());
}

public sealed class UpdateAiAgentCommandValidator : AbstractValidator<UpdateAiAgentCommand>
{
    public UpdateAiAgentCommandValidator() => RuleFor(x => x.Request).SetValidator(new SaveAiAgentRequestValidator());
}

public sealed class TestAiAgentStreamValidator : AbstractValidator<TestAiAgentStream>
{
    public TestAiAgentStreamValidator() => RuleFor(x => x.Request.Agent).SetValidator(new SaveAiAgentRequestValidator());
}
