using System.Text.Json;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Reads a model reply that asks the user to choose between readings of an ambiguous question
/// (SuperSonic shows the top interpretations the same way). Each option carries its own spec,
/// checked against the real columns like any other; invalid options are dropped.
/// </summary>
public static class Clarification
{
    public const int MaxOptions = 3;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The model's reply that the dataset has nothing for the question, e.g. no downtime column; else null.</summary>
    public static string? Missing(string raw)
    {
        var s = raw.Trim();
        var start = s.IndexOf('{'); var stop = s.LastIndexOf('}');
        if (start < 0 || stop <= start) return null;
        try
        {
            var root = JsonDocument.Parse(s[start..(stop + 1)]).RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("missing", out var m) || m.ValueKind != JsonValueKind.String) return null;
            var text = m.GetString()!.Trim();
            return text.Length == 0 ? null : Wording.Sentence(text.Length > 300 ? text[..300] : text);
        }
        catch (JsonException) { return null; }
    }

    /// <summary>
    /// Null when the reply is not a clarification. Otherwise the valid options (possibly 0 or 1;
    /// the caller asks the user only when there are 2 or more).
    /// </summary>
    public static AiClarification? TryParse(string raw, IReadOnlyList<string> columns)
    {
        var s = raw.Trim();
        var start = s.IndexOf('{'); var stop = s.LastIndexOf('}');
        if (start < 0 || stop <= start) return null;
        JsonElement root;
        try { root = JsonDocument.Parse(s[start..(stop + 1)]).RootElement; }
        catch (JsonException) { return null; }
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("clarify", out var ask) || ask.ValueKind != JsonValueKind.String) return null;

        var options = new List<AiClarifyOption>();
        if (root.TryGetProperty("options", out var list) && list.ValueKind == JsonValueKind.Array)
            foreach (var o in list.EnumerateArray())
            {
                if (options.Count == MaxOptions) break;
                var label = o.TryGetProperty("label", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString()!.Trim() : "";
                if (label.Length == 0 || !o.TryGetProperty("spec", out var specJson)) continue;
                try
                {
                    var spec = QuerySpecEngine.Validate(specJson.Deserialize<AiQuerySpec>(Json)!, columns);
                    options.Add(new AiClarifyOption(Wording.Capitalize(label.Length > 120 ? label[..120] : label), spec));
                }
                catch (Exception ex) when (ex is InvalidOperationException or JsonException or NullReferenceException) { /* drop this option */ }
            }
        var question = ask.GetString()!.Trim();
        return new AiClarification(Wording.Sentence(question.Length > 300 ? question[..300] : question, '?'), options);
    }
}
