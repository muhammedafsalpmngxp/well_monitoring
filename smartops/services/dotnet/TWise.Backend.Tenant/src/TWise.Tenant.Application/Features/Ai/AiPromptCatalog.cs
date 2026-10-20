using System.Text.RegularExpressions;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Every AI prompt a tenant has, by key: its group, name and description on Settings → AI Prompts, and what a save
/// must keep so the code can still use it. The TEXTS are not here: they live only in the tenant database
/// (core.AiPrompt, history in core.AiPromptHistory), seeded once from Resources/ai-prompts.seed.json.
///
/// A save must keep every {PLACEHOLDER} of the prompt's original text (the code fills them with the question, the
/// data, the schema…) and, for the prompts whose reply the code parses, the JSON keys of that reply.
/// </summary>
public static partial class AiPromptCatalog
{
    public const string Features = "features";
    public const string AskData = "askdata";
    public const string AskDataMessages = "askdata-messages";
    public const string Agents = "agents";

    /// <summary>Longest text a prompt may have (the largest original, the Ask Data business rules, is about 13,000).</summary>
    public const int MaxLength = 100_000;

    /// <summary>The groups of Settings → AI Prompts: the built-in ones, then one per Agentic Feature (its key).</summary>
    public static readonly IReadOnlyList<(string Key, string Title)> Groups =
    [
        (Features, "AI features"),
        (AskData, "Ask Data: prompts and knowledge"),
        (AskDataMessages, "Ask Data: message templates"),
        (Agents, "Agents"),
        .. AgenticFeatureCatalog.All.Values.Select(f => (f.Key, f.Title)),
    ];

    /// <summary>Every prompt: the built-in ones below, then each Agentic Feature's from agentic-features.seed.json
    /// (group = the feature key, e.g. "slippage"; keys start with the feature key and a dot).</summary>
    public static readonly IReadOnlyList<AiPromptDefinition> All =
    [
        .. AgenticFeatureCatalog.All.Values.SelectMany(f => f.Prompts.Select(p =>
            new AiPromptDefinition(p.Key, f.Key, p.Name, p.Description, p.ReplyKeys, p.AllowEmpty))),

        // ── AI features (Tenant API) ──────────────────────────────────────────────────────────────────────────
        F(AiPrompts.AskRules, "Extra rules for questions", "Added to the instructions that turn a question into a query on a dataset, e.g. \"A year means the fiscal year starting 1 April\". Leave empty for none.", allowEmpty: true),
        F(AiPrompts.Answer, "Answer style", "How the AI words an answer from the result rows (Ask your data on a dataset)."),
        F(AiPrompts.ChartSummary, "Explain a chart", "How the AI explains one chart's data."),
        F(AiPrompts.DashboardSummary, "Explain a dashboard", "How the AI briefs a whole dashboard."),
        F(AiPrompts.Report, "Insight report recommendations", "How the AI turns the checked findings of an insight report into recommendations."),
        F(AiPrompts.Filters, "Suggest dashboard filters", "What makes a good dashboard-wide filter when the AI recommends filters."),
        F(AiPrompts.ChartEdit, "Edit chart by chat", "How the AI reads a chart-edit instruction. The allowed fields and the reply format are added by code."),
        F(AiPrompts.ChartSuggest, "Suggest charts and dashboards", "How the AI picks chart types when it proposes charts or designs a dashboard."),
        F(AiPrompts.Extract, "Learn dataset notes", "What the AI may propose as a dataset note after an answered question (Learning)."),
        F(AiPrompts.Review, "Review answers", "How the AI judges whether a query answered the question before it is kept as an example (Learning)."),
        F(AiPrompts.Deck, "Slide deck narrative", "How the AI writes the speaker text of an exported slide deck."),
        F(AiPrompts.SqlReview, "SQL review", "How the AI explains a view's SQL and proposes a faster equivalent. The plan facts and reply format are added by code."),
        F(AiPrompts.AlertMessage, "Alert message", "How the AI words the notification and e-mail when an alert starts firing."),

        // ── Ask Data: system prompts and knowledge (agent runtime) ────────────────────────────────────────────
        A("askdata.platform_preamble", "Platform preamble", "Opening of the orchestrator, SQL author, analyst, synthesizer and verifier prompts: the workflow and the accuracy rules."),
        A("askdata.orchestrator_system", "Orchestrator", "Understands the question and decides: query the data, ask the user to clarify, or reply without data.", "route"),
        A("askdata.planner_system", "Planner", "For questions that need several queries: decides whether to run another query or answer.", "action"),
        A("askdata.sql_author_system", "SQL author", "Writes the read-only T-SQL. The placeholders bring in the preamble, SQL knowledge, business rules, SQL rules and examples."),
        A("askdata.sql_knowledge", "SQL knowledge", "T-SQL dialect guidance for the SQL author (TOP, schema.table, dates, aggregates). MAX_ROWS becomes the row limit."),
        A("askdata.sql_rules", "SQL authoring rules", "How the SQL author matches the user's exact intent. The read-only safety checks are code and cannot be weakened here."),
        A("askdata.analysis_system", "Analyst", "Reasons over the retrieved rows: calculations, rankings, trends, predictions."),
        A("askdata.verifier_system", "Verifier", "Checks the SQL and its data actually answer the question before the answer is written.", "ok", "feedback"),
        A("askdata.synthesize_system", "Answer writer", "Writes the final answer from the verified data."),
        A("askdata.answer_rules", "Answer integrity rules", "Added to the analyst, answer writer and verifier: every number from the data, NULL is not zero, and so on."),
        A("askdata.chitchat_system", "Chitchat", "Replies to messages that need no data (greetings, questions about the assistant). {{ORG_NAME}} becomes the organisation name."),
        A("askdata.business_rules", "Business rules", "What the business's tables and fields mean. Used by every agent whose Knowledge Source leaves business rules empty, and by Ask your data."),
        A("askdata.few_shots", "Examples (few-shots)", "Example questions with their correct SQL. Used when an agent's Knowledge Source leaves examples empty, and by Ask your data."),

        // ── Ask Data: what each node adds to its message ──────────────────────────────────────────────────────
        M("history_header", "Conversation: heading", "Heading above earlier turns in a follow-up question."),
        M("history_user", "Conversation: user line", "One earlier user message."),
        M("history_assistant", "Conversation: assistant line", "One earlier answer."),
        M("step_header", "Query block: heading", "Heading of one query and its data, shown to the analyst, verifier and answer writer."),
        M("step_block", "Query block", "One query with its SQL and result table."),
        M("step_truncated", "Query block: capped result", "Warning added when a result was cut at the row limit."),
        M("no_data", "No data retrieved", "Shown in place of the data when no query returned anything."),
        M("table_no_columns", "Result table: no columns", "Shown in place of a result table without columns."),
        M("table_no_rows", "Result table: no rows", "Shown in place of an empty result table."),
        M("table_more", "Result table: cut", "Note under a result table that shows only the first rows."),
        M("orchestrator", "Orchestrator: message", "The orchestrator's message: the conversation so far and the question."),
        M("planner", "Planner: message", "The planner's message: the question, the data gathered so far and the query budget."),
        M("planner_nothing", "Planner: nothing gathered", "The planner's summary before any query ran."),
        M("planner_step", "Planner: one query", "One gathered query with its row and column counts."),
        M("planner_columns", "Planner: columns", "The columns of a gathered query."),
        M("planner_columns_extra", "Planner: more columns", "How many columns are not listed."),
        M("planner_sample", "Planner: sample row", "One sample row of a gathered query."),
        M("planner_more_rows", "Planner: more rows", "How many rows the sample does not show."),
        M("sql_schema", "SQL author: schema heading", "Heading above the database schema."),
        M("sql_already", "SQL author: already retrieved", "The queries already run in this question."),
        M("sql_request", "SQL author: request", "The data request to write SQL for."),
        M("sql_plan", "SQL author: plan", "The orchestrator's plan (data needed and result size)."),
        M("sql_chart", "SQL author: chart rules", "Added when the user asked for a chart: the result shape a chart needs."),
        M("sql_chart_numeric_donut", "SQL author: donut chart values", "The value-column rule for a donut chart."),
        M("sql_chart_numeric", "SQL author: chart values", "The value-column rule for other charts."),
        M("sql_retry_validator", "SQL author: rejected by the safety check", "Added when the previous SQL failed the read-only safety check."),
        M("sql_retry_exec", "SQL author: database error", "Added when the previous SQL failed in the database."),
        M("sql_retry_verifier", "SQL author: rejected by the verifier", "Added when the verifier rejected the previous query's data."),
        M("sql_retry_verifier_previous", "SQL author: the rejected SQL", "The SQL the verifier rejected."),
        M("sql_tried", "SQL author: attempts so far", "How many queries were already tried in this question."),
        M("sql_final", "SQL author: closing line", "The last line of the SQL author's message."),
        M("analysis", "Analyst: message", "The analyst's message: the question and the retrieved data."),
        M("verifier_schema", "Verifier: schema", "The schema the verifier judges the SQL against."),
        M("verifier_question", "Verifier: question", "The user's question for the verifier."),
        M("verifier_data", "Verifier: SQL and data", "The executed SQL and its data."),
        M("verifier_analysis", "Verifier: analyst's findings", "The analyst's findings, when there are any."),
        M("verifier_concerns", "Verifier: schema concerns", "Concerns found by code from the schema's keys, for the verifier to judge."),
        M("verifier_concern", "Verifier: one concern", "One schema concern."),
        M("verifier_final", "Verifier: closing line", "The last line of the verifier's message."),
        M("verifier_unreadable", "Verifier: review failed", "Sent to the SQL author when the verifier's verdict could not be read."),
        M("synth_no_data", "Answer writer: no data", "The answer writer's message when no data could be retrieved."),
        M("synth_no_data_error", "Answer writer: no data reason", "The reason given when no query returned data and there was no error."),
        M("synth_question", "Answer writer: question", "The user's question for the answer writer."),
        M("synth_data", "Answer writer: data", "The retrieved data for the answer writer."),
        M("synth_analysis", "Answer writer: analyst's findings", "The analyst's findings, when there are any."),
        M("synth_unverified", "Answer writer: unverified data", "Added when the data did not pass verification."),
        M("synth_final", "Answer writer: closing line", "The last line of the answer writer's message."),
        M("chitchat", "Chitchat: message", "The message the chitchat reply answers."),
        M("chitchat_entities", "Chitchat: entity names", "Names of things in the database the reply may use as examples."),

        // ── Agents (agent runtime) ────────────────────────────────────────────────────────────────────────────
        G("agent.supervisor", "Supervisor", "Supervisor agents: picks the next step, or FINISH.", "next"),
        G("agent.worker", "Supervisor: one step", "One step in the supervisor's list."),
        G("agent.loop_check", "Loop check", "Loop agents: decides whether the results meet the goal.", "done"),
        G("agent.router", "AI router", "Router steps routed by AI: picks one branch.", "branch"),
        G("agent.router_none_fits", "AI router: none fits", "Added to the router's reply format when the router has an Otherwise branch."),
        G("agent.choice", "AI router: one branch", "One branch in the router's list."),
        G("agent.answer", "Final answer", "Combines the step results into one answer (agents with several steps)."),
        G("agent.answer_role", "Final answer: role", "The agent's role, before its system prompt."),
        G("agent.answer_goal", "Final answer: goal", "The agent's goal, after its system prompt."),
        G("agent.answer_step", "Final answer: one step", "One step's question and result."),
        G("agent.answer_result", "Final answer: step result", "A step's answer."),
        G("agent.answer_failed", "Final answer: failed step", "A step's error."),
        G("agent.profile_role", "Agent profile: role", "The agent's role, for the supervisor, router and loop check."),
        G("agent.profile_goal", "Agent profile: goal", "The agent's goal, for the supervisor, router and loop check."),
        G("agent.progress_results", "Progress: results", "The results so far, for the supervisor, router and loop check."),
        G("agent.progress_none", "Progress: no results", "Shown before any step has a result."),
        G("agent.progress_step", "Progress: one step", "One step's question and result."),
        G("agent.progress_failed", "Progress: failed step", "A step's error."),
        G("agent.progress_inputs", "Progress: inputs", "The run's inputs."),
        G("agent.progress_input", "Progress: one input", "One input and its value."),
        G("agent.extract_inputs", "Question: read the inputs", "Agents with an input named question: one call on the fast model fills the agent's other inputs from the user's words.", "values", "note"),
        G("agent.extract_input", "Question: one input", "One input (name, type, description) in that list."),
    ];

    private static readonly Dictionary<string, AiPromptDefinition> ByKey = All.ToDictionary(d => d.Key, StringComparer.Ordinal);

    public static bool IsKnown(string key) => ByKey.ContainsKey(key);

    public static AiPromptDefinition Get(string key) =>
        ByKey.TryGetValue(key, out var d) ? d : throw new InvalidOperationException($"Unknown AI prompt '{key}'.");

    /// <summary>The prompts the agent runtime uses (askdata.* and agent.*), as it receives them with each request.</summary>
    public static IReadOnlyDictionary<string, string> RuntimeTexts(IReadOnlyDictionary<string, string> texts) =>
        texts.Where(kv => ByKey.TryGetValue(kv.Key, out var d) && d.Group is AskData or AskDataMessages or Agents)
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

    /// <summary>One Agentic Feature's prompts (group = the feature key), as the agent runtime receives them with each
    /// request of that feature.</summary>
    public static IReadOnlyDictionary<string, string> FeatureTexts(IReadOnlyDictionary<string, string> texts, string feature) =>
        texts.Where(kv => ByKey.TryGetValue(kv.Key, out var d) && d.Group == feature)
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

    /// <summary>The {PLACEHOLDER} names in a text, in order of first use. {{ORG_NAME}} is optional and not one of them.</summary>
    public static IReadOnlyList<string> Placeholders(string text) =>
        PlaceholderRegex().Matches(text ?? "").Select(m => m.Groups[1].Value).Where(n => n != "ORG_NAME").Distinct().ToList();

    /// <summary>Why a new text cannot be saved, or null when it can: length, emptiness, the original's placeholders and
    /// the reply keys the code parses.</summary>
    public static string? Problem(AiPromptDefinition def, string text, string originalText)
    {
        // Invariant culture: the server's locale must not change the message (en-IN wrote 1,00,000).
        if (text.Length > MaxLength) return string.Create(System.Globalization.CultureInfo.InvariantCulture, $"Keep the text under {MaxLength:N0} characters.");
        if (text.Length == 0) return def.AllowEmpty ? null : "This prompt cannot be empty. Use Restore original to go back to the first version.";
        var missing = Placeholders(originalText).Where(p => !text.Contains("{" + p + "}", StringComparison.Ordinal)).ToList();
        if (missing.Count > 0)
            return $"Keep the placeholder{(missing.Count > 1 ? "s" : "")} {string.Join(", ", missing.Select(p => "{" + p + "}"))}: the code puts the run's data there.";
        var replies = def.ReplyKeys.Where(k => !text.Contains("\"" + k + "\"", StringComparison.Ordinal)).ToList();
        if (replies.Count > 0)
            return $"Keep the reply format: the code reads the JSON key{(replies.Count > 1 ? "s" : "")} {string.Join(", ", replies.Select(k => "\"" + k + "\""))} from the AI's answer.";
        return null;
    }

    private static AiPromptDefinition F(string key, string name, string description, bool allowEmpty = false) =>
        new(key, Features, name, description, [], allowEmpty);

    private static AiPromptDefinition A(string key, string name, string description, params string[] replyKeys) =>
        new(key, AskData, name, description, replyKeys, false);

    private static AiPromptDefinition M(string name, string title, string description) =>
        new("askdata.msg." + name, AskDataMessages, title, description, [], false);

    private static AiPromptDefinition G(string key, string name, string description, params string[] replyKeys) =>
        new(key, Agents, name, description, replyKeys, false);

    [GeneratedRegex(@"\{([A-Z][A-Z0-9_]*)\}")]
    private static partial Regex PlaceholderRegex();
}

/// <summary>One prompt key: where it shows, and the JSON keys of the AI's reply that the code reads (must stay).</summary>
public sealed record AiPromptDefinition(string Key, string Group, string Name, string Description, IReadOnlyList<string> ReplyKeys, bool AllowEmpty);
