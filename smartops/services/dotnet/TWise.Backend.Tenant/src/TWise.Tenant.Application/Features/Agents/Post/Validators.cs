using System.Text.RegularExpressions;
using FluentValidation;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Rules every saved or tested agent must meet.</summary>
public sealed class SaveAiAgentRequestValidator : AbstractValidator<SaveAiAgentRequest>
{
    public static readonly string[] Statuses = ["draft", "published"];
    public static readonly string[] Types = ["sequential", "parallel", "supervisor", "loop"];
    public static readonly string[] Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    public static readonly string[] ParamTypes = ["str", "int", "float", "bool", "list", "dict"];
    public static readonly string[] AuthSchemes = ["none", "bearer", "basic", "api_key"];
    /// <summary>Node ids the canvas and the runtime use themselves.</summary>
    public static readonly string[] ReservedIds = ["start", "answer", "supervisor", "check", "remember"];
    public static readonly string[] RuleOps = ["equals", "not_equals", "contains", "not_contains", "gt", "gte", "lt", "lte", "empty", "not_empty", "else"];
    public static readonly string[] NoteColors = ["yellow", "blue", "green", "pink"];

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
        RuleFor(x => x.Steps).NotEmpty().WithMessage("Add at least one instruction.").Must(s => s is null || s.Count <= 20).WithMessage("An agent can have up to 20 instructions.");
        RuleForEach(x => x.Steps).ChildRules(s =>
        {
            s.RuleFor(x => x.Text).NotEmpty().WithMessage("An instruction is empty.").MaximumLength(2000);
            s.RuleFor(x => x.Id).MaximumLength(64)
                .Must(id => id is null || !ReservedIds.Contains(id)).WithMessage("A step id cannot be start, answer, supervisor, check or remember (the canvas uses them).");
            s.RuleFor(x => x.Sql).MaximumLength(MaxSql).WithMessage($"A step's SQL can be up to {MaxSql} characters.");
            s.RuleFor(x => x.Kind).Must(k => k is "step" or "router" or AgentMapping.SetupKind)
                .WithMessage("A step is an instruction, a router or the setup step.");
            s.RuleFor(x => x.ExpectedOutput).MaximumLength(2000);
            s.RuleFor(x => x.OutputKey).Matches("^[A-Za-z_][A-Za-z0-9_]{0,49}$").When(x => x.OutputKey is not null)
                .WithMessage("Output keys use letters, digits and _ (they are used as {{key}} in later instructions).");
            s.RuleFor(x => x.Model).MaximumLength(100);
            s.RuleFor(x => x.Temperature).InclusiveBetween(0, 2).When(x => x.Temperature is not null).WithMessage("Temperature must be between 0 and 2.");
            s.RuleFor(x => x.MaxTokens).InclusiveBetween(1, 32000).When(x => x.MaxTokens is not null).WithMessage("Max tokens must be between 1 and 32000.");
            s.RuleFor(x => x.RouteBy).Must(r => r is "rules" or "ai").WithMessage("A router routes by rules or by AI.");
            s.RuleFor(x => x.Options).Must(o => o is null || o.Value.ValueKind == System.Text.Json.JsonValueKind.Object && o.Value.GetRawText().Length <= 4000)
                .WithMessage("Step options are a small JSON object.");
            s.RuleFor(x => x).Must(x => x.Tool?.Agent != AgentMapping.ComputeTool || AgentMapping.ComputeModes.Contains(AgentMapping.Option(x, "mode") ?? "template"))
                .WithMessage("Compute mode is template, pick or math.");
            s.RuleFor(x => x.Retries).InclusiveBetween(0, 5).When(x => x.Retries is not null).WithMessage("Retries must be between 0 and 5.");
            s.RuleFor(x => x.ForEach).Matches("^[A-Za-z_][A-Za-z0-9_]{0,49}$").When(x => x.ForEach is not null)
                .WithMessage("For each names an input or an output key.");
            s.RuleFor(x => x.Tool!.Action).Must(a => long.TryParse(a, out var id) && id > 0)
                .When(x => x.Tool?.Agent == AgentMapping.SubAgentTool).WithMessage("Pick the agent a sub-agent step runs.");
            s.RuleFor(x => x.Branches).NotEmpty().When(x => x.Kind == "router").WithMessage("A router needs at least one branch.")
                .Must(b => b is null || b.Count <= 10).WithMessage("A router can have up to 10 branches.");
            s.RuleForEach(x => x.Branches).ChildRules(b =>
            {
                b.RuleFor(x => x.Op).Must(o => RuleOps.Contains(o)).WithMessage("Unknown branch rule.");
                b.RuleFor(x => x.Label).MaximumLength(200);
                b.RuleFor(x => x.Value).MaximumLength(500);
            });
        });
        RuleFor(x => x.CustomTools).Must(t => t is null || t.Count <= 20).WithMessage("An agent can have up to 20 tools.")
            .Must(t => t is null || t.Select(x => x.Name).Distinct(StringComparer.Ordinal).Count() == t.Count).WithMessage("Tool names must be unique.");
        RuleForEach(x => x.CustomTools).SetValidator(new CustomToolValidator());
        RuleFor(x => x.Notes).Must(n => n is null || n.Count <= 50).WithMessage("An agent can have up to 50 notes.");
        RuleForEach(x => x.Notes).ChildRules(n =>
        {
            n.RuleFor(x => x.Id).NotEmpty().MaximumLength(64);
            n.RuleFor(x => x.Text).MaximumLength(2000);
            n.RuleFor(x => x.Color).Must(c => NoteColors.Contains(c)).WithMessage("Unknown note colour.");
        });
        // Rules across steps and tools: only when both are there (the rules for those report them missing).
        When(r => r.Steps is not null && r.Tools is not null, () =>
        {
            RuleFor(x => x).Must(r =>
                {
                    var keys = r.Steps.Where(s => s.OutputKey is not null).Select(s => s.OutputKey!).ToList();
                    return keys.Distinct(StringComparer.Ordinal).Count() == keys.Count
                        && !keys.Intersect((r.Inputs ?? []).Select(i => i.Name), StringComparer.Ordinal).Any();
                })
                .WithMessage("Output keys must be unique and differ from the input names.");
            RuleFor(x => x).Must(r => r.Tools.Concat(r.Steps.Where(s => s.Tool is not null).Select(s => s.Tool!))
                    .Where(t => t.Agent == AgentMapping.ApiTool).All(t => (r.CustomTools ?? []).Any(c => c.Name == t.Action)))
                .WithMessage("A step uses a Tool that is not defined on this agent.");
            RuleFor(x => x).Must(r => r.Steps.Where(s => s.ForEach is not null).All(s => s.Kind == "step"
                    && ((r.Inputs ?? []).Any(i => i.Name == s.ForEach) || r.Steps.Any(o => o != s && o.OutputKey == s.ForEach))))
                .WithMessage("For each must name an input or another step's output key.");
            RuleFor(x => x).Must(r => (r.Type ?? "").Trim().ToLowerInvariant() is "sequential" or "loop" || !AgentMapping.UsesTool(r, AgentMapping.EvaluatorTool))
                .WithMessage("Evaluator works in Sequential and Loop agents (it may send the run back).");
            RuleFor(x => x).Must(r => r.Steps.Where(s => s.Tool?.Agent == AgentMapping.EvaluatorTool && AgentMapping.Option(s, "retryFrom") is not null)
                    .All(s => r.Steps.TakeWhile(o => o != s).Any(o => o.Id == AgentMapping.Option(s, "retryFrom"))))
                .WithMessage("An Evaluator can only send the run back to an earlier step.");
            RuleFor(x => x).Must(r => (r.Type ?? "").Trim().ToLowerInvariant() != "parallel" || !AgentMapping.UsesTool(r, AgentMapping.ApprovalTool))
                .WithMessage("Human Approval works in Sequential, Loop and Supervisor agents (not Parallel).");
            RuleFor(x => x).Must(r => (r.Type ?? "").Trim().ToLowerInvariant() == "loop" || !AgentMapping.UsesTool(r, AgentMapping.ExitLoopTool))
                .WithMessage("Exit Loop works in Loop agents only.");
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
        RuleForEach(x => x.Tools).Must(t => t.Agent != AgentMapping.SqlQueryTool || AgentMapping.SqlQueryActions.Contains(t.Action))
            .WithMessage("Saved SQL runs as table or summary.");
        RuleFor(x => x).Custom((r, ctx) =>
        {
            foreach (var problem in SqlProblems(r)) ctx.AddFailure("Steps", problem);
            if (SetupProblem(r) is { } setup) ctx.AddFailure("Steps", setup);
        });
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

    public const int MaxSql = 20000;
    private static readonly Regex SqlComment = new(@"--[^\n]*|/\*.*?\*/", RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex SqlPlaceholder = new(@"\{\{\s*(\w+)\s*\}\}", RegexOptions.Compiled);

    /// <summary>
    /// What stops a Saved SQL step from running: no SQL, not a SELECT, or an {{input}} the agent does not have. The
    /// agent runtime checks the rest before it runs (one SELECT only, no writes, only tables Ask Data may read).
    /// </summary>
    public static IEnumerable<string> SqlProblems(SaveAiAgentRequest r)
    {
        if (r.Steps is null) yield break;
        var inputs = (r.Inputs ?? []).Select(i => i.Name).ToHashSet(StringComparer.Ordinal);
        for (var i = 0; i < r.Steps.Count; i++)
        {
            var s = r.Steps[i];
            if (s is null || s.Kind == "router" || AgentMapping.ToolOf(r, s)?.Agent != AgentMapping.SqlQueryTool) continue;
            var text = s.Text ?? "";
            var at = $"Step {i + 1} ('{(text.Length <= 40 ? text : text[..40])}') uses Saved SQL:";
            var sql = SqlComment.Replace(s.Sql ?? "", " ").Trim();
            if (sql.Length == 0) { yield return $"{at} write its SQL."; continue; }
            var first = sql.Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries)[0].TrimStart('(').ToUpperInvariant();
            if (first is not ("SELECT" or "WITH")) yield return $"{at} its SQL must be one SELECT (or WITH ... SELECT).";
            var unknown = SqlPlaceholder.Matches(sql).Select(m => m.Groups[1].Value).Where(n => !inputs.Contains(n)).Distinct().ToList();
            if (unknown.Count > 0)
                yield return $"{at} its SQL uses {string.Join(", ", unknown.Select(n => "{{" + n + "}}"))}, which is not an input. Add it under Inputs & Outputs.";
            if (HiddenPlaceholders(s.Sql ?? "") > 0)
                yield return $"{at} an {{{{input}}}} inside a longer quoted text or a comment cannot be a parameter. Write it outside the quotes, e.g. LIKE '%' + {{{{name}}}} + '%', and remove it from comments.";
        }
    }

    private static readonly Regex QuotedPlaceholder = new(@"'\{\{\s*\w+\s*\}\}'|\{\{\s*\w+\s*\}\}", RegexOptions.Compiled);
    private static readonly Regex SqlString = new(@"'(?:[^']|'')*'", RegexOptions.Compiled);

    /// <summary>
    /// Placeholders inside a longer quoted text ('%{{name}}%') or a comment: the runtime would turn each into a ? that SQL
    /// Server does not see as a parameter, so every run would fail. Same check as the runtime's sqlstep.hidden_placeholders;
    /// a placeholder that is the whole quoted text ('{{name}}') is a parameter and is not counted.
    /// </summary>
    public static int HiddenPlaceholders(string sql)
    {
        const string mark = " __placeholder__ ";
        var marked = QuotedPlaceholder.Replace(sql, mark);
        var all = Regex.Matches(marked, "__placeholder__").Count;
        var visible = Regex.Matches(SqlString.Replace(SqlComment.Replace(marked, " "), " '' "), "__placeholder__").Count;
        return all - visible;
    }

    /// <summary>
    /// Same rules as the runtime (models.py _check_setup): the setup step is the first step, there is one, it uses Saved
    /// SQL, links nowhere, nothing links back to it, and at least one step follows it.
    /// </summary>
    public static string? SetupProblem(SaveAiAgentRequest r)
    {
        if (r.Steps is null) return null;
        var setups = r.Steps.Select((s, i) => (s, i)).Where(p => p.s?.Kind == AgentMapping.SetupKind).Select(p => p.i).ToList();
        if (setups.Count == 0) return null;
        if (setups is not [0]) return "Only the first step can be the setup step, and there can be one.";
        var setup = r.Steps[0];
        if (AgentMapping.ToolOf(r, setup)?.Agent != AgentMapping.SqlQueryTool) return "The setup step must use Saved SQL.";
        if (setup.Next is not null) return "The setup step always runs first; it cannot link to another step.";
        if (r.Steps.Count < 2) return "Add at least one step after the setup step.";
        if (setup.Id is { } id && r.Steps.Any(s => s.Next == id || (s.Branches ?? []).Any(b => b.Target == id)))
            return "No step or branch can go back to the setup step.";
        return null;
    }

    /// <summary>Same checks as the runtime: routing only where steps run in order, and every target exists.</summary>
    private static bool RoutesAreValid(SaveAiAgentRequest r)
    {
        if (r.Steps is null) return true;   // NotEmpty reports it
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
    private static string? CircleAt(SaveAiAgentRequest r) => Walk(r).Circle;

    /// <summary>
    /// The text of the first step no path from the start reaches (e.g. a router dropped on the Canvas that nothing
    /// links to), or null. Checked on save: such a step is saved but never runs.
    /// </summary>
    public static string? NeverReached(SaveAiAgentRequest r)
    {
        var (circle, reached) = Walk(r);
        if (circle is not null || reached is null) return null;
        return r.Steps.Where((_, i) => !reached[i]).Select(s => s.Text).FirstOrDefault();
    }

    private static (string? Circle, bool[]? Reached) Walk(SaveAiAgentRequest r)
    {
        if ((r.Type ?? "").Trim().ToLowerInvariant() is not ("sequential" or "loop") || r.Steps is not { Count: > 0 }) return (null, null);
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

        // A circle: plain step links only. A router branch may go back (draft ↔ review): the run caps how often a step
        // is gone back to (maxIterations), as the runtime does.
        var state = new int[r.Steps.Count];   // 1 = on the current path, 2 = done
        string? Visit(int i)
        {
            if (state[i] == 2) return null;
            if (state[i] == 1) return r.Steps[i].Text;
            state[i] = 1;
            if (r.Steps[i].Kind != "router")
                foreach (var n in Next(i))
                    if (n is { } m && Visit(m) is { } hit) return hit;
            state[i] = 2;
            return null;
        }
        string? circle = null;
        for (var i = 0; i < r.Steps.Count && circle is null; i++) circle = Visit(i);

        // Reached: every link from the first step, router branches included.
        var reached = new bool[r.Steps.Count];
        var todo = new Stack<int>([0]);
        while (todo.Count > 0)
        {
            var i = todo.Pop();
            if (reached[i]) continue;
            reached[i] = true;
            foreach (var n in Next(i))
                if (n is { } m && !reached[m]) todo.Push(m);
        }
        return (circle, reached);
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

/// <summary>One Tool node: a REST call the model may make.</summary>
public sealed class CustomToolValidator : AbstractValidator<AiAgentCustomToolDto>
{
    public CustomToolValidator()
    {
        RuleFor(x => x.Name).Matches("^[A-Za-z_][A-Za-z0-9_]{0,63}$").WithMessage("Tool names use letters, digits and _ (the model calls the tool by it).");
        RuleFor(x => x.Description).MaximumLength(1000);
        RuleFor(x => x.Method).Must(m => SaveAiAgentRequestValidator.Methods.Contains(m)).WithMessage("Method must be GET, POST, PUT, PATCH or DELETE.");
        RuleFor(x => x.Url).Must(u => Uri.TryCreate(u, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback)))
            .WithMessage("The tool URL must be an absolute https URL (http only for localhost).").MaximumLength(2000);
        RuleFor(x => x.AuthScheme).Must(a => SaveAiAgentRequestValidator.AuthSchemes.Contains(a)).WithMessage("Auth must be none, bearer, basic or api_key.");
        RuleFor(x => x.Timeout).InclusiveBetween(1, 120);
        RuleFor(x => x.Body).MaximumLength(20000);
        RuleFor(x => x.Parameters).Must(p => p is null || p.Count <= 20).WithMessage("A tool can have up to 20 parameters.");
        RuleForEach(x => x.Parameters).ChildRules(p =>
        {
            p.RuleFor(x => x.Name).Matches("^[A-Za-z_][A-Za-z0-9_]{0,49}$").WithMessage("Parameter names use letters, digits and _.");
            p.RuleFor(x => x.Type).Must(t => SaveAiAgentRequestValidator.ParamTypes.Contains(t)).WithMessage("Unknown parameter type.");
        });
        RuleForEach(x => x.Headers).ChildRules(h => h.RuleFor(x => x.Name).Matches("^[A-Za-z0-9-]{1,100}$").WithMessage("Header names use letters, digits and -."));
    }
}

public sealed class TryAgentToolQueryValidator : AbstractValidator<TryAgentToolQuery>
{
    public TryAgentToolQueryValidator() => RuleFor(x => x.Request.Tool).SetValidator(new CustomToolValidator());
}

public sealed class ResumeAiAgentRunStreamValidator : AbstractValidator<ResumeAiAgentRunStream>
{
    public ResumeAiAgentRunStreamValidator()
    {
        RuleFor(x => x.Request.Token).NotEmpty().MaximumLength(200)
            .Must((s, t) => t.StartsWith($"agent-{s.TenantId}-", StringComparison.Ordinal)).WithMessage("This approval does not belong to the run.");
        RuleFor(x => x.Request.Decision).Must(d => d is "approve" or "edit" or "reject").WithMessage("Decide approve, edit or reject.");
        RuleFor(x => x.Request.Text).MaximumLength(20000);
    }
}

public sealed class CreateAiAgentCommandValidator : AbstractValidator<CreateAiAgentCommand>
{
    public CreateAiAgentCommandValidator()
    {
        RuleFor(x => x.Request).SetValidator(new SaveAiAgentRequestValidator());
        RuleFor(x => x.Request).Custom((r, ctx) => SavedSteps.AllReached(r, ctx));
    }
}

public sealed class UpdateAiAgentCommandValidator : AbstractValidator<UpdateAiAgentCommand>
{
    public UpdateAiAgentCommandValidator()
    {
        RuleFor(x => x.Request).SetValidator(new SaveAiAgentRequestValidator());
        RuleFor(x => x.Request).Custom((r, ctx) => SavedSteps.AllReached(r, ctx));
    }
}

/// <summary>Save-only rule (a test run may try a half-built flow): every step must be reachable from the start.</summary>
internal static class SavedSteps
{
    public static void AllReached(SaveAiAgentRequest r, ValidationContext<CreateAiAgentCommand> ctx) => Check(r, ctx.AddFailure);
    public static void AllReached(SaveAiAgentRequest r, ValidationContext<UpdateAiAgentCommand> ctx) => Check(r, ctx.AddFailure);

    private static void Check(SaveAiAgentRequest r, Action<string, string> fail)
    {
        if (SaveAiAgentRequestValidator.NeverReached(r) is { } text)
            fail("Steps", $"'{(text.Length <= 40 ? text : text[..40])}' is never reached. On the Canvas, link a step or a branch to it, or remove it.");
    }
}

public sealed class TestAiAgentStreamValidator : AbstractValidator<TestAiAgentStream>
{
    public TestAiAgentStreamValidator()
    {
        RuleFor(x => x.Request.Agent).SetValidator(new SaveAiAgentRequestValidator());
        RuleFor(x => x.Request.ThreadId).Matches("^[A-Za-z0-9-]{1,64}$").When(x => x.Request.ThreadId is not null)
            .WithMessage("A conversation id uses letters, digits and -.");
    }
}
