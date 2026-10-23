using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// The AI features an admin can grant per role. Adding a feature is one line here plus its
/// enforcement point (server check and/or UI *ngIf on the feature key).
/// </summary>
public static class AiFeatureCatalog
{
    public const string Ask = "ask";
    public const string Chart = "chart";
    public const string Learning = "learning";
    public const string Summary = "summary";
    public const string Filters = "filters";
    public const string Edit = "edit";
    public const string Recommend = "recommend";
    public const string Dashboard = "dashboard";
    public const string Trace = "trace";
    public const string Alerts = "alerts";
    public const string Sql = "sql";
    public const string Dictionary = "dictionary";

    public static readonly IReadOnlyList<AiFeatureDto> All =
    [
        new(Ask, "Ask your data", "Question panel from the top bar"),
        new(Chart, "Open as chart", "Send an answer to the Chart Builder"),
        new(Learning, "Learning", "Thumbs-up examples and dataset notes"),
        new(Summary, "Explain charts", "Narrative summary of a chart's data"),
        new(Filters, "Suggest filters", "AI-recommended dashboard-wide filters"),
        new(Edit, "Edit chart by chat", "Change a chart's type, mapping or display in plain words"),
        new(Recommend, "Recommend charts", "Three suggested charts for a loaded data source"),
        new(Dashboard, "Dashboard from a prompt", "Generate a first dashboard from a dataset and a goal"),
        new(Trace, "Prompt trace", "See what was sent to the AI for an answer, step by step"),
        new(Alerts, "Alerts", "Watch an answer and be notified when it crosses a limit or looks unusual"),
        new(Sql, "SQL review", "Explain and tune a view's SQL in the Database View builder"),
        new(Dictionary, "Draft the data dictionary", "AI drafts business names, descriptions and sensitivity for a dataset's columns; you review and save"),
    ];

    public static bool IsKnown(string key) => All.Any(f => f.Key == key);

    /// <summary>A grant row for one of the user's roles is required; admin roles are not special (an admin can switch a feature off for admins too).</summary>
    public static bool IsAllowed(string featureKey, IReadOnlyList<string> roles, IEnumerable<AiFeatureRole> grants) =>
        grants.Any(g => g.FeatureKey == featureKey && roles.Contains(g.RoleCode, StringComparer.OrdinalIgnoreCase));
}
