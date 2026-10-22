using System.Text;
using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.SqlReview;

/// <summary>
/// The view service applies the read-only guard and reads the estimated plan; one AI call then
/// explains the query and proposes changes, grounded in those plan facts. The proposed SQL is
/// passed through the same guard so a rewrite can never introduce a write.
/// </summary>
public sealed class ReviewSqlHandler(IDatabaseViewService views, IAiService ai, IAiAskService ask, IAiPromptStore store, AiSqlReviewOptions options) : IRequestHandler<ReviewSqlCommand, AiSqlReviewDto?>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<AiSqlReviewDto?> Handle(ReviewSqlCommand c, CancellationToken ct)
    {
        if (!await ask.FeatureOnAsync(c.TenantId, AiFeatureCatalog.Sql, ct))
            throw new InvalidOperationException("SQL review is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var explained = await views.ExplainAsync(c.Request, c.TenantId, ct);
        if (explained is null) return null;
        var (sql, plan) = explained.Value;
        if (sql.Length > options.MaxSqlLength) throw new InvalidOperationException($"The SQL is too long to review (max {options.MaxSqlLength} characters).");

        var facts = new StringBuilder();
        if (plan is null) facts.Append("Plan facts: not available (the database did not return an estimated plan).\n");
        else
        {
            facts.Append($"Plan facts (estimated, query not run): {plan.Statements} statement(s), total cost {plan.EstimatedCost}, ~{plan.EstimatedRows:N0} rows.\n");
            if (plan.Scans.Count > 0) facts.Append("Scans: ").Append(string.Join("; ", plan.Scans)).Append('\n');
            if (plan.MissingIndexes.Count > 0) facts.Append("Missing indexes suggested by SQL Server: ").Append(string.Join("; ", plan.MissingIndexes)).Append('\n');
            if (plan.Warnings.Count > 0) facts.Append("Optimizer warnings: ").Append(string.Join("; ", plan.Warnings)).Append('\n');
        }
        var prompts = await store.GetAsync(c.TenantId, ct);
        var messages = new List<AiMessage>
        {
            new("system", AiPrompts.Text(AiPrompts.SqlReview, prompts) +
                " Reply with JSON only: {\"explanation\":\"...\",\"issues\":[{\"severity\":\"high|medium|low\",\"text\":\"...\"}],\"suggestions\":[\"...\"],\"optimisedSql\":\"... or empty\",\"optimisedNote\":\"what changed and why, or why no rewrite\"}. " +
                "The optimised SQL must be a single read-only T-SQL batch without GO."),
            new("user", $"{facts}\nQuery:\n{sql}"),
        };
        var raw = (await ai.CompleteAsync(c.TenantId, c.UserId.ToString(), "sql", messages, ct)).Content.Trim();
        ReviewJson? parsed;
        try
        {
            if (raw.StartsWith("```")) { raw = raw[(raw.IndexOf('\n') + 1)..]; var end = raw.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) raw = raw[..end]; }
            var start = raw.IndexOf('{'); var stop = raw.LastIndexOf('}');
            parsed = JsonSerializer.Deserialize<ReviewJson>(raw[start..(stop + 1)], Json);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try again."); }
        if (parsed is null) throw new InvalidOperationException("The AI reply could not be read. Try again.");

        // A rewrite the guard rejects (or that only restates the query) is dropped, not shown.
        var optimised = (parsed.OptimisedSql ?? "").Trim();
        var note = (parsed.OptimisedNote ?? "").Trim();
        if (optimised.Length > 0)
        {
            if (Normalise(optimised) == Normalise(sql)) { optimised = ""; note = note.Length > 0 ? note : "No rewrite needed."; }
            else
            {
                try { await views.ExplainAsync(new AiSqlReviewRequest(c.Request.ConnectionId, optimised, null), c.TenantId, ct); }
                catch (InvalidOperationException ex) { optimised = ""; note = "The proposed rewrite was dropped: " + ex.Message; }
            }
        }
        var issues = (parsed.Issues ?? []).Where(i => !string.IsNullOrWhiteSpace(i.Text))
            .Select(i => new AiSqlIssueDto(i.Severity?.Trim().ToLowerInvariant() is "high" or "medium" or "low" ? i.Severity!.Trim().ToLowerInvariant() : "medium", i.Text!.Trim())).ToList();
        return new AiSqlReviewDto((parsed.Explanation ?? "").Trim(), issues,
            (parsed.Suggestions ?? []).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToList(),
            optimised.Length == 0 ? null : optimised, note.Length == 0 ? null : note, plan);
    }

    private static string Normalise(string s) => string.Join(" ", s.Split((char[])null!, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

    private sealed record ReviewJson(string? Explanation, List<IssueJson>? Issues, List<string>? Suggestions, string? OptimisedSql, string? OptimisedNote);
    private sealed record IssueJson(string? Severity, string? Text);
}
