using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class DashboardLogoStorage(IConfiguration configuration, IHostEnvironment environment) : IDashboardLogoStorage
{
    public const int MaxBytes = 2 * 1024 * 1024;
    private static readonly Regex AssetPattern = new(@"^([1-9][0-9]*)_([a-f0-9]{32})\.(png|jpg|webp)$", RegexOptions.Compiled);
    private readonly string root = Path.GetFullPath(configuration["DashboardLogos:StoragePath"]
        ?? Path.Combine(environment.ContentRootPath, "App_Data", "dashboard-logos"));

    public async Task<DashboardLogoAsset> SaveAsync(long tenantId, string fileName, Stream content, CancellationToken ct)
    {
        if (tenantId <= 0) throw new ArgumentOutOfRangeException(nameof(tenantId));
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int bytesRead;
        while ((bytesRead = await content.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + bytesRead > MaxBytes) throw new InvalidOperationException("Logo must not exceed 2 MB.");
            buffer.Write(chunk, 0, bytesRead);
        }
        var bytes = buffer.ToArray();
        var extension = DetectExtension(bytes) ?? throw new InvalidOperationException("Choose a PNG, JPEG or WebP image.");
        var assetId = $"{tenantId.ToString(CultureInfo.InvariantCulture)}_{Guid.NewGuid():N}.{extension}";
        Directory.CreateDirectory(root);
        await File.WriteAllBytesAsync(Path.Combine(root, assetId), bytes, ct);
        var displayName = Path.GetFileName(fileName.Replace('\\', '/'));
        if (displayName.Length > 150) displayName = displayName[..150];
        return new DashboardLogoAsset(assetId, displayName, bytes.Length);
    }

    public async Task<DashboardLogoContent?> ReadAsync(string assetId, long? tenantId, CancellationToken ct)
    {
        var match = AssetPattern.Match(assetId);
        if (!match.Success || !long.TryParse(match.Groups[1].Value, out var ownerTenant)) return null;
        if (tenantId.HasValue && tenantId.Value != ownerTenant) return null;
        var path = Path.Combine(root, assetId);
        if (!File.Exists(path)) return null;
        var bytes = await File.ReadAllBytesAsync(path, ct);
        var extension = DetectExtension(bytes);
        return extension is null ? null : new DashboardLogoContent(bytes, extension == "jpg" ? "image/jpeg" : $"image/{extension}");
    }

    private static string? DetectExtension(byte[] bytes)
    {
        if (bytes.Length >= 24 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
            && bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8)) return "png";
        if (bytes.Length >= 4 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255
            && bytes[^2] == 255 && bytes[^1] == 217) return "jpg";
        if (bytes.Length >= 16 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8)
            && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return "webp";
        return null;
    }
}