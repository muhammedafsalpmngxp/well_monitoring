using System.Text;
using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Deck;

/// <summary>
/// One AI call turns the charts' rows into the deck narrative as JSON; the slides are then matched
/// back to the charts by position so the client can pair each with its captured image.
/// </summary>
public sealed class BuildAiDeckHandler(IAiService ai, IAiAskService ask, IAiSettingsRepository settings) : IRequestHandler<BuildAiDeckCommand, AiDeckDto>
{
    public const int MaxCharts = 12;
    private const int RowsPerChart = 60;
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
                .Append(JsonSerializer.Serialize(charts[i].Rows.Take(RowsPerChart), Json)).Append('\n');
        var prompts = AiPrompts.Parse((await settings.GetAsync(c.TenantId, ct))?.PromptsJson);
        var messages = new List<AiMessage>
        {
            new("system", AiPrompts.Text(AiPrompts.Deck, prompts) +
                $" Reply with JSON only: {{\"headline\":\"...\",\"slides\":[{{\"title\":\"...\",\"bullets\":[\"...\"],\"takeaway\":\"...\"}}],\"closing\":\"...\"}} with exactly {charts.Count} slides, in the order the charts are given."),
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
        return new AiDeckDto(c.Request.Title, (parsed.Headline ?? "").Trim(), slides, (parsed.Closing ?? "").Trim());
    }

    private sealed record DeckJson(string? Headline, List<DeckSlideJson>? Slides, string? Closing);
    private sealed record DeckSlideJson(string? Title, List<string>? Bullets, string? Takeaway);
}
