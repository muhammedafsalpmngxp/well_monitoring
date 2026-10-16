using System.IO.Compression;
using System.Text.Json;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Reads the metadata out of a Power BI custom visual package (.pbiviz). The package is a zip:
/// package.json (visual + author) and resources/&lt;guid&gt;.pbiviz.json (capabilities, icon, and
/// again visual + author). The compiled visual.js is deliberately ignored — it only runs inside
/// the Power BI visual host, so what we keep is the description, not the code.
/// </summary>
public static class PowerBiVisualPackageReader
{
    // The .pbiviz.json embeds the compiled visual, so large packages run to tens of megabytes.
    private const int MaxEntryBytes = 64 * 1024 * 1024;
    private const int MaxDescription = 1000;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static MarketplacePlugin Read(Stream package)
    {
        using var zip = new ZipArchive(package, ZipArchiveMode.Read, leaveOpen: true);

        var manifest = ReadJson(zip, "package.json") ?? throw Invalid("package.json is missing");
        var resource = zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(".pbiviz.json", StringComparison.OrdinalIgnoreCase));
        var pbiviz = resource is null ? null : ReadJson(zip, resource.FullName);

        var visual = Prop(pbiviz, "visual") ?? Prop(manifest, "visual") ?? throw Invalid("no visual section");
        var guid = Str(visual, "guid") ?? throw Invalid("the visual has no guid");
        var author = Prop(pbiviz, "author") ?? Prop(manifest, "author");
        var capabilities = Prop(pbiviz, "capabilities");

        return new MarketplacePlugin
        {
            PluginId = guid,
            Name = Str(visual, "displayName") ?? Str(visual, "name") ?? guid,
            Description = Truncate(Str(visual, "description") ?? "", MaxDescription),
            Version = Str(visual, "version") ?? Str(manifest, "version") ?? "0.0.0",
            Publisher = Str(author, "name") ?? "Unknown",
            VisualKey = ("pbiviz-" + guid).ToLowerInvariant(),
            RenderKind = CustomVisualRenderKinds.PowerBiVisual,
            Icon = "custom",
            ImageUrl = Str(Prop(pbiviz, "content"), "iconBase64"),
            DataRolesJson = JsonSerializer.Serialize(DataRoles(capabilities), JsonOptions),
            FeaturesJson = JsonSerializer.Serialize(Features(capabilities), JsonOptions),
            // Not a template — the visual renders only inside an embedded Power BI report.
            OptionsTemplateJson = "{}",
        };
    }

    /// <summary>capabilities.dataRoles → our roles. Grouping ⇒ dimension, Measure ⇒ measure.</summary>
    private static List<CustomVisualDataRole> DataRoles(JsonElement? capabilities)
    {
        var roles = new List<CustomVisualDataRole>();
        if (Prop(capabilities, "dataRoles") is not { ValueKind: JsonValueKind.Array } array) return roles;
        foreach (var role in array.EnumerateArray())
        {
            var key = Str(role, "name");
            if (key is null) continue;
            var kind = Str(role, "kind");
            var type = string.Equals(kind, "Measure", StringComparison.OrdinalIgnoreCase)
                ? CustomVisualRoleTypes.Measure : CustomVisualRoleTypes.Dimension;
            roles.Add(new CustomVisualDataRole(key, Str(role, "displayName") ?? key, type, Required: false, AllowMultiple: true));
        }
        return roles;
    }

    /// <summary>Formatting groups (capabilities.objects) double as the card's feature list.</summary>
    private static List<string> Features(JsonElement? capabilities)
    {
        var features = new List<string>();
        if (Prop(capabilities, "objects") is not { ValueKind: JsonValueKind.Object } objects) return features;
        foreach (var obj in objects.EnumerateObject())
        {
            var label = Str(obj.Value, "displayName") ?? obj.Name;
            if (!string.IsNullOrWhiteSpace(label)) features.Add(label);
            if (features.Count == 8) break;
        }
        return features;
    }

    private static JsonElement? ReadJson(ZipArchive zip, string name)
    {
        var entry = zip.GetEntry(name);
        if (entry is null) return null;
        if (entry.Length > MaxEntryBytes) throw Invalid($"{name} is too large");
        using var stream = entry.Open();
        try { return JsonDocument.Parse(stream).RootElement.Clone(); }
        catch (JsonException) { throw Invalid($"{name} is not valid JSON"); }
    }

    private static JsonElement? Prop(JsonElement? element, string name)
        => element is { ValueKind: JsonValueKind.Object } e && e.TryGetProperty(name, out var value) ? value : null;

    private static string? Str(JsonElement? element, string name)
        => Prop(element, name) is { ValueKind: JsonValueKind.String } s ? s.GetString() : null;

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    private static InvalidOperationException Invalid(string why) => new($"Not a valid .pbiviz package: {why}.");
}
