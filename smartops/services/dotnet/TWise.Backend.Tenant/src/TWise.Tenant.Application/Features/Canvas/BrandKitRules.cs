using System.Text.Json;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Canvas;

/// <summary>A brand kit as the canvas sends and reads it: a name and the kit as a JSON object.</summary>
public sealed record BrandKitRequest(string? Name, JsonElement? Kit);

public sealed record BrandKitDto(long Id, string Name, JsonElement Kit, DateTime ModifiedAt)
{
    public static BrandKitDto From(BrandKit kit)
    {
        using var document = JsonDocument.Parse(kit.Kit);
        return new(kit.Id, kit.Name, document.RootElement.Clone(), kit.ModifiedAt);
    }
}

/// <summary>
/// What a saved brand kit must be. The canvas checks each setting of a kit again when it applies one, so the server
/// only keeps the shape: a name, and a JSON object small enough for a logo of about 400 KB.
/// </summary>
public static class BrandKitRules
{
    public const int MaxName = 80;
    public const int MaxKitLength = 600_000;

    /// <summary>Why the request cannot be saved, or null when it can.</summary>
    public static string? Problem(BrandKitRequest request)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length == 0) return "Give the brand kit a name.";
        if (name.Length > MaxName) return $"A brand kit name has at most {MaxName} characters.";
        if (request.Kit is not { ValueKind: JsonValueKind.Object } kit) return "The brand kit is missing.";
        return kit.GetRawText().Length > MaxKitLength ? "The brand kit is too large. Use a smaller logo." : null;
    }
}
