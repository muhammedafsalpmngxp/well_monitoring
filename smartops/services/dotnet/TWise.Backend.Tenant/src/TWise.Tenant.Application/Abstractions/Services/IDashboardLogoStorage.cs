namespace TWise.Tenant.Application.Abstractions.Services;

public record DashboardLogoAsset(string AssetId, string FileName, long Size);
public record DashboardLogoContent(byte[] Bytes, string ContentType);

public interface IDashboardLogoStorage
{
    Task<DashboardLogoAsset> SaveAsync(long tenantId, string fileName, Stream content, CancellationToken ct);
    Task<DashboardLogoContent?> ReadAsync(string assetId, long? tenantId, CancellationToken ct);
}