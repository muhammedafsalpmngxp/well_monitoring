using System.Globalization;
using System.Text;
using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Dictionary;

/// <summary>
/// One AI call drafts the dictionary of a dataset from its columns, their types, the documentation already written and a
/// few example values the dataset already holds (no query runs). Columns marked pii or confidential send no examples.
/// Nothing is saved: the editor shows the draft for an admin to review and save.
/// </summary>
public sealed class DraftDictionaryHandler(IGovernanceService governance, IAiService ai, IAiAskService ask, IAiPromptStore store, AiDictionaryOptions options)
    : IRequestHandler<DraftDictionaryCommand, DictionaryDraftDto?>
{
    // Column sizes of core.DataDictionary, not settings.
    private const int NameLength = 200;
    private const int DescriptionLength = 2000;
    private const int TagsLength = 500;
    private static readonly string[] Sensitivities = ["public", "internal", "confidential", "pii"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<DictionaryDraftDto?> Handle(DraftDictionaryCommand c, CancellationToken ct)
    {
        if (!await ask.FeatureOnAsync(c.TenantId, AiFeatureCatalog.Dictionary, ct))
            throw new InvalidOperationException("Drafting the data dictionary is not enabled for your role. An admin can grant it under Settings → AI Features.");
        var dataset = await governance.GetDatasetAsync(c.Kind, c.Id, c.TenantId, ct);
        if (dataset is null) return null;
        if (dataset.Columns.Count == 0) throw new InvalidOperationException("This dataset has no columns to document yet.");
        var columns = dataset.Columns.Take(options.MaxColumns).ToList();
        var rows = await governance.SampleRowsAsync(c.Kind, c.Id, c.TenantId, options.SampleRows, ct) ?? [];

        var user = new StringBuilder($"Dataset: {dataset.Name} ({(c.Kind == "view" ? "database view" : "imported file")})\n");
        if (!string.IsNullOrWhiteSpace(dataset.Description)) user.Append($"Current dataset description: {dataset.Description}\n");
        user.Append("Columns (name | type | current documentation | example values):\n");
        foreach (var col in columns)
        {
            var current = string.Join("; ", new[] { col.BusinessName, col.Description }.Where(s => !string.IsNullOrWhiteSpace(s)));
            var examples = col.Sensitivity is "pii" or "confidential" ? "(not shown: marked " + col.Sensitivity + ")" : string.Join(", ", Examples(rows, col.ColumnName));
            user.Append($"- {col.ColumnName} | {col.DataType} | {(current.Length > 0 ? current : "none")} | {(examples.Length > 0 ? examples : "none")}\n");
        }

        var prompts = await store.GetAsync(c.TenantId, ct);
        var messages = new List<AiMessage>
        {
            new("system", AiPrompts.Text(AiPrompts.Dictionary, prompts) +
                " Reply with JSON only: {\"description\":\"...\",\"columns\":[{\"column\":\"exact column name\",\"businessName\":\"...\",\"description\":\"...\",\"sensitivity\":\"public|internal|confidential|pii\",\"tags\":\"tag1, tag2\"}]} with one entry per column listed."),
            new("user", user.ToString()),
        };
        var raw = (await ai.CompleteAsync(c.TenantId, c.UserId.ToString(CultureInfo.InvariantCulture), "dictionary", messages, ct)).Content.Trim();
        DraftJson? parsed;
        try
        {
            if (raw.StartsWith("```")) { raw = raw[(raw.IndexOf('\n') + 1)..]; var end = raw.LastIndexOf("```", StringComparison.Ordinal); if (end >= 0) raw = raw[..end]; }
            var start = raw.IndexOf('{'); var stop = raw.LastIndexOf('}');
            parsed = JsonSerializer.Deserialize<DraftJson>(raw[start..(stop + 1)], Json);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentOutOfRangeException) { throw new InvalidOperationException("The AI reply could not be read. Try again."); }
        if (parsed is null) throw new InvalidOperationException("The AI reply could not be read. Try again.");

        // Only the dataset's own columns, once each, in the dataset's order and spelling.
        var byName = (parsed.Columns ?? []).Where(d => !string.IsNullOrWhiteSpace(d.Column))
            .GroupBy(d => d.Column!.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var drafts = columns.Where(col => byName.ContainsKey(col.ColumnName)).Select(col =>
        {
            var d = byName[col.ColumnName];
            var sensitivity = (d.Sensitivity ?? "").Trim().ToLowerInvariant();
            return new DictionaryColumnDraftDto(col.ColumnName, Cut(d.BusinessName, NameLength), Cut(d.Description, DescriptionLength),
                Sensitivities.Contains(sensitivity) ? sensitivity : "internal", Cut(d.Tags, TagsLength));
        }).ToList();
        return new DictionaryDraftDto(Cut(parsed.Description, DescriptionLength), drafts);
    }

    /// <summary>Distinct non-empty example values of one column, each cut to the configured length.</summary>
    private IEnumerable<string> Examples(IReadOnlyList<Dictionary<string, object?>> rows, string column) =>
        rows.Select(r => r.FirstOrDefault(kv => string.Equals(kv.Key, column, StringComparison.OrdinalIgnoreCase)).Value?.ToString()?.Trim())
            .Where(v => !string.IsNullOrEmpty(v)).Select(v => v!.Length > options.SampleValueLength ? v[..options.SampleValueLength] : v!)
            .Distinct().Take(options.SampleValues);

    private static string? Cut(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().Length > max ? s.Trim()[..max] : s.Trim();

    private sealed record DraftJson(string? Description, List<ColumnJson>? Columns);
    private sealed record ColumnJson(string? Column, string? BusinessName, string? Description, string? Sensitivity, string? Tags);
}
