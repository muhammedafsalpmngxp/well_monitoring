using System.Text.Json;
using System.Text.RegularExpressions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Validates a custom visual definition before it is stored.
///
/// Security rationale — a stored template is rendered in every viewer's browser, so a visual
/// authored by one user runs in the session of everyone who opens a dashboard using it:
///
///   * The template must be pure JSON. Highcharts accepts JavaScript callbacks for options
///     like <c>formatter</c>; allowing those would be arbitrary code execution with the
///     viewer's privileges, so any key that Highcharts treats as a callback is rejected.
///   * <c>useHTML</c> and HTML-bearing options are rejected because Highcharts renders those
///     without escaping, which is a stored-XSS vector.
///   * Values are scanned for script-ish content even under otherwise-allowed keys, since a
///     renderer that ever passed one to innerHTML would execute it.
///
/// Rejecting is deliberately preferred over sanitising: a silently rewritten template would
/// render differently to what the author saw, and the blocked options are all avoidable.
/// </summary>
public static class CustomVisualValidator
{
    /// <summary>A visual key must be safe to use as an identifier in URLs and JSON keys.</summary>
    private static readonly Regex VisualKeyPattern = new(@"^[a-z][a-z0-9-]{1,48}[a-z0-9]$", RegexOptions.Compiled);

    /// <summary>
    /// Placeholders bound to data roles. Two forms, deliberately explicit so that what a
    /// placeholder resolves to never depends on where it sits in the template:
    ///
    ///   {{role}}        the role's DATA - an array of category labels for a dimension,
    ///                   an array of numbers for a measure.
    ///   {{role.label}}  the role's COLUMN NAME, as text, for titles and series names.
    ///
    /// Group 1 is the role name in both forms, so role resolution is the same for each.
    /// </summary>
    private static readonly Regex PlaceholderPattern =
        new(@"\{\{\s*([a-zA-Z0-9_]+)(?:\.(label))?\s*\}\}", RegexOptions.Compiled);

    /// <summary>
    /// Option names Highcharts evaluates as callbacks, or that render unescaped HTML.
    /// Matched case-insensitively against every property name in the template.
    /// </summary>
    private static readonly string[] ForbiddenKeys =
    [
        "formatter", "labelformatter", "pointformatter", "datalabelsformatter",
        "events", "load", "click", "select", "unselect", "setextremes",
        "usehtml", "onclick", "onload", "onerror", "onmouseover",
        "chart.events", "series.events", "point.events",
        "function", "callback", "beforeprint", "afterprint", "render"
    ];

    /// <summary>Content that only appears in an attempt to smuggle executable code.</summary>
    private static readonly Regex ScriptLikeValue = new(
        @"(<\s*script)|(javascript\s*:)|(\bfunction\s*\()|(=>)|(\beval\s*\()|(new\s+Function)|(\bon\w+\s*=)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Built-in chart types a custom visual may not shadow.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "bar", "line", "pie", "donut", "multiline", "area", "spline", "column", "stacked",
        "table", "combo", "grouped", "waterfall", "treemap", "scatter", "histogram", "gauge",
        "bullet", "sankey", "timeline", "bubble", "heatmap", "trend", "kpi", "funnel"
    };

    /// <summary>
    /// Canonical form of a visual key. Delegates to the domain rule so that validation and
    /// storage agree; every writer must store the key through this.
    /// </summary>
    public static string NormaliseKey(string visualKey) => CustomVisualKeys.Normalise(visualKey);

    public static CustomVisualValidationResult Validate(
        string visualKey, string optionsTemplateJson, IReadOnlyList<CustomVisualDataRole> roles, string renderKind)
    {
        var errors = new List<string>();
        var warnings = new List<string>();

        // ── Key ──────────────────────────────────────────────────────────────
        if (string.IsNullOrWhiteSpace(visualKey))
            errors.Add("A visual key is required.");
        else if (!VisualKeyPattern.IsMatch(CustomVisualKeys.Normalise(visualKey)))
            errors.Add("The visual key must be lower-case letters, digits and hyphens, 3-50 characters, starting with a letter.");
        else if (ReservedKeys.Contains(CustomVisualKeys.Normalise(visualKey)))
            errors.Add($"'{visualKey}' is a built-in chart type and cannot be reused.");

        if (!CustomVisualRenderKinds.IsSupported(renderKind))
            errors.Add($"Render kind must be one of: {string.Join(", ", CustomVisualRenderKinds.All)}.");

        // ── Data roles ───────────────────────────────────────────────────────
        var roleKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var role in roles)
        {
            if (string.IsNullOrWhiteSpace(role.Key))
                errors.Add("Every data role needs a key.");
            else if (!roleKeys.Add(role.Key.Trim()))
                errors.Add($"Duplicate data role '{role.Key}'.");

            if (!CustomVisualRoleTypes.IsSupported(role.Type))
                errors.Add($"Data role '{role.Key}' has an unknown type '{role.Type}'. Use dimension or measure.");
        }

        if (roles.Count == 0)
            warnings.Add("This visual declares no data roles, so the builder cannot bind any columns to it.");

        // ── Template ─────────────────────────────────────────────────────────
        JsonDocument? doc = null;
        try
        {
            doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(optionsTemplateJson) ? "{}" : optionsTemplateJson);
        }
        catch (JsonException ex)
        {
            errors.Add($"The options template is not valid JSON: {ex.Message}");
        }

        if (doc is not null)
        {
            using (doc)
            {
                if (doc.RootElement.ValueKind != JsonValueKind.Object)
                    errors.Add("The options template must be a JSON object.");
                else
                    Inspect(doc.RootElement, "", errors);

                // Every placeholder must resolve to a declared role, or it renders as literal text.
                foreach (Match m in PlaceholderPattern.Matches(optionsTemplateJson ?? ""))
                {
                    var name = m.Groups[1].Value;
                    if (!roleKeys.Contains(name))
                        errors.Add($"The template uses {{{{{name}}}}} but no data role named '{name}' is declared.");
                }

                foreach (var role in roles.Where(r => r.Required))
                {
                    if (!PlaceholderPattern.Matches(optionsTemplateJson ?? "")
                            .Any(m => m.Groups[1].Value.Equals(role.Key, StringComparison.OrdinalIgnoreCase)))
                        warnings.Add($"Required role '{role.Key}' is never used in the template.");
                }
            }
        }

        return new CustomVisualValidationResult(errors.Count == 0, errors, warnings);
    }

    /// <summary>
    /// Walks the template rejecting callback/HTML keys and script-like values at any depth.
    /// A nested object is just as dangerous as a top-level one, so the check is recursive.
    /// </summary>
    private static void Inspect(JsonElement element, string path, List<string> errors)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in element.EnumerateObject())
                {
                    var name = prop.Name;
                    var here = string.IsNullOrEmpty(path) ? name : $"{path}.{name}";

                    if (ForbiddenKeys.Any(k => name.Equals(k, StringComparison.OrdinalIgnoreCase)))
                    {
                        errors.Add(
                            $"'{here}' is not allowed: Highcharts treats it as executable code or unescaped HTML. " +
                            "Custom visuals are declarative only.");
                        continue;
                    }

                    Inspect(prop.Value, here, errors);
                }
                break;

            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                    Inspect(item, $"{path}[{index++}]", errors);
                break;

            case JsonValueKind.String:
                var value = element.GetString() ?? "";
                if (ScriptLikeValue.IsMatch(value))
                    errors.Add($"The value at '{path}' looks like executable code or markup, which is not allowed.");
                break;
        }
    }
}
