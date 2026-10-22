using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Deck;

/// <summary>
/// One AI call turns the charts' rows into the deck narrative as JSON; the slides are then matched
/// back to the charts by position so the client can pair each with its captured image.
/// </summary>
public sealed partial class BuildAiDeckHandler(IAiService ai, IAiAskService ask, IAiPromptStore store, AiExplainOptions explain) : IRequestHandler<BuildAiDeckCommand, AiDeckDto>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<AiDeckDto> Handle(BuildAiDeckCommand c, CancellationToken ct)
    {
        if (!await ask.FeatureOnAsync(c.TenantId, AiFeatureCatalog.Summary, ct))
            throw new InvalidOperationException("Explain charts is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var charts = c.Request.Charts.Where(x => x.Columns is { Count: > 0 } && x.Rows is { Count: > 0 }).ToList();
        if (charts.Count == 0) throw new InvalidOperationException("There is no chart data for a deck yet.");

        var body = new StringBuilder();
        for (var i = 0; i < charts.Count; i++)
            body.Append("Chart ").Append(i + 1).Append(" \"").Append(charts[i].Title).Append("\" (").Append(string.Join(", ", charts[i].Columns)).Append("): ")
                .Append(JsonSerializer.Serialize(charts[i].Rows.Take(explain.DashboardRowsPerChart), Json)).Append('\n');
        var prompts = await store.GetAsync(c.TenantId, ct);
        var messages = new List<AiMessage>
        {
            new("system", AiPrompts.Text(AiPrompts.Deck, prompts) +
                $" Reply with JSON only: {{\"headline\":\"...\",\"keyFigures\":[{{\"label\":\"...\",\"value\":\"...\",\"note\":\"...\"}}],\"slides\":[{{\"title\":\"...\",\"bullets\":[\"...\"],\"takeaway\":\"...\"}}],\"closing\":\"...\"}} with exactly {charts.Count} slides, in the order the charts are given." +
                " " + AiPrompts.Text(AiPrompts.DeckKeyFigures, prompts).Replace("{MAX}", explain.DeckKeyFigures.ToString(CultureInfo.InvariantCulture))),
            new("user", $"Dashboard: {c.Request.Title}\n{body}"),
        };
        var raw = (await ai.CompleteAsync(c.TenantId, c.UserId.ToString(), "deck", messages, ct)).Content.Trim();
        DeckJson? parsed;
        try
        {
            if (raw.StartsWith("```")) { raw = raw[(raw.IndexOf('\n') + 1)..]; var end = raw.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) raw = raw[..end]; }
            var start = raw.IndexOf('{'); var stop = raw.LastIndexOf('}');
            parsed = JsonSerializer.Deserialize<DeckJson>(raw[start..(stop + 1)], Json);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try again."); }
        if (parsed is null) throw new InvalidOperationException("The AI reply could not be read. Try again.");

        // A missing or extra slide must not shift the pairing with the chart images: pad or cut to the chart count.
        var slides = charts.Select((chart, i) =>
        {
            var s = i < (parsed.Slides?.Count ?? 0) ? parsed.Slides![i] : null;
            var bullets = (s?.Bullets ?? []).Where(b => !string.IsNullOrWhiteSpace(b)).Select(b => b.Trim()).Take(4).ToList();
            return new AiDeckSlideDto(string.IsNullOrWhiteSpace(s?.Title) ? chart.Title : s!.Title.Trim(), bullets, string.IsNullOrWhiteSpace(s?.Takeaway) ? null : s!.Takeaway.Trim());
        }).ToList();
        return new AiDeckDto(c.Request.Title, (parsed.Headline ?? "").Trim(), slides, (parsed.Closing ?? "").Trim(), GroundedFigures(parsed.KeyFigures, charts, explain.DashboardRowsPerChart, explain.DeckKeyFigures));
    }

    [GeneratedRegex(@"(-?\d[\d,]*(?:\.(\d+))?)\s*([kKmMbB%])?")]
    private static partial Regex Number();

    /// <summary>
    /// The AI's key figures, kept only when every number in a value is in the data sent: a cell, a column total, or (with %)
    /// a cell's share of its column total, within the rounding the value is written with. The deck never shows an invented figure.
    /// </summary>
    internal static IReadOnlyList<AiDeckFigureDto> GroundedFigures(IEnumerable<DeckFigureJson>? figures, IReadOnlyList<AiSummaryRequest> charts, int rowsPerChart, int maxFigures)
    {
        var values = new List<double>();
        var shares = new List<double>();
        foreach (var chart in charts)
            foreach (var col in chart.Columns)
            {
                var cells = chart.Rows.Take(rowsPerChart).Select(r => r.TryGetValue(col, out var v) ? Num(v) : null).OfType<double>().ToList();
                if (cells.Count == 0) continue;
                var total = cells.Sum();
                values.AddRange(cells);
                values.Add(total);
                if (total != 0) shares.AddRange(cells.Select(v => v / total * 100));
            }

        bool Grounded(string value)
        {
            var found = Number().Matches(value);
            return found.Count > 0 && found.All(m =>
            {
                var digits = m.Groups[1].Value.Replace(",", "");
                if (!double.TryParse(digits, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)) return false;
                var unit = m.Groups[3].Value.ToLowerInvariant();
                var scale = unit switch { "k" => 1e3, "m" => 1e6, "b" => 1e9, _ => 1 };
                // "1.2k" stands for anything from 1,150 to 1,250: half a unit of its last digit.
                var tolerance = 0.5 * Math.Pow(10, -m.Groups[2].Value.Length) * scale + 1e-9;
                return (unit == "%" ? shares : values).Any(v => Math.Abs(Math.Abs(v) - Math.Abs(n * scale)) <= tolerance);
            });
        }

        return (figures ?? []).Where(f => !string.IsNullOrWhiteSpace(f?.Label) && !string.IsNullOrWhiteSpace(f?.Value) && Grounded(f.Value))
            .Take(maxFigures)
            .Select(f => new AiDeckFigureDto(f.Label!.Trim(), f.Value!.Trim(), string.IsNullOrWhiteSpace(f.Note) ? null : f.Note.Trim()))
            .ToList();
    }

    private static double? Num(object? v) => v switch
    {
        JsonElement { ValueKind: JsonValueKind.Number } e => e.GetDouble(),
        double d => d, float f => f, decimal m => (double)m, long l => l, int i => i,
        _ => null,
    };

    private sealed record DeckJson(string? Headline, List<DeckSlideJson>? Slides, string? Closing, List<DeckFigureJson>? KeyFigures);
    internal sealed record DeckFigureJson(string? Label, string? Value, string? Note);
    private sealed record DeckSlideJson(string? Title, List<string>? Bullets, string? Takeaway);
}
