using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class ImportedDatasetService(IImportedDatasetRepository repo, IFileImportParserService parser) : IImportedDatasetService
{
    // Row-count safety net; the hard limit is also enforced by CK_ImportedDatasets_RowCount in the DB.
    public const int MaxRows = 10_000;

    private static readonly HashSet<string> SupportedExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".csv", ".xlsx", ".xls", ".json" };

    public async Task<IReadOnlyList<ImportedDatasetListDto>> GetAllAsync(long tenantId, long userId, CancellationToken ct = default)
    {
        var datasets = await repo.GetAllAsync(tenantId, userId, ct);
        return datasets.Select(ToListDto).ToList();
    }

    public async Task<ImportedDatasetDto?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var dataset = await repo.GetByIdAsync(id, tenantId, ct);
        return dataset is null ? null : ToDto(dataset);
    }

    public async Task<ImportedDatasetDataResponse?> GetDataAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var dataset = await repo.GetByIdAsync(id, tenantId, ct);
        if (dataset is null) return null;

        var columns = JsonSerializer.Deserialize<List<ImportColumnDto>>(dataset.ColumnsJson) ?? [];
        var rowJsonList = await repo.GetRowsAsync(id, MaxRows, ct);
        var rows = rowJsonList
            .Select(json => JsonSerializer.Deserialize<Dictionary<string, object?>>(json) ?? [])
            .ToList();

        return new ImportedDatasetDataResponse(columns.Select(c => c.Name).ToList(), rows, dataset.RowCount);
    }

    public async Task<ImportedDatasetDto> ImportAsync(
        Stream fileStream, string fileName, string? datasetName, long userId, long tenantId, CancellationToken ct = default)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (!SupportedExtensions.Contains(extension))
            throw new InvalidOperationException($"Unsupported file type '{extension}'. Allowed: csv, xlsx, xls, json.");

        var fileType = extension.TrimStart('.');
        var parsed = parser.Parse(fileStream, fileName, fileType);

        if (parsed.Rows.Count > MaxRows)
            throw new InvalidOperationException(
                $"File has {parsed.Rows.Count} rows, which exceeds the {MaxRows}-row import limit. Please split the file and import in parts.");

        var dataset = new ImportedDataset
        {
            DatasetName = string.IsNullOrWhiteSpace(datasetName) ? Path.GetFileNameWithoutExtension(fileName) : datasetName,
            FileName = fileName,
            FileType = fileType,
            ColumnsJson = JsonSerializer.Serialize(parsed.Columns),
            RowCount = parsed.Rows.Count,
            Status = "completed",
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow,
            IsDeleted = false
        };

        var rowJsonList = parsed.Rows.Select(r => JsonSerializer.Serialize(r)).ToList();
        var saved = await repo.CreateWithRowsAsync(dataset, rowJsonList, ct);
        return ToDto(saved);
    }

    public Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default)
        => repo.SoftDeleteAsync(id, userId, tenantId, ct);

    private static ImportedDatasetListDto ToListDto(ImportedDataset d) =>
        new(d.Id, d.DatasetName, d.FileName, d.FileType, d.RowCount, d.Status, d.CreatedAt);

    private static ImportedDatasetDto ToDto(ImportedDataset d) => new(
        d.Id, d.DatasetName, d.FileName, d.FileType,
        JsonSerializer.Deserialize<List<ImportColumnDto>>(d.ColumnsJson) ?? [],
        d.RowCount, d.Status, d.ErrorMessage,
        d.TenantId, d.CreatedBy, d.CreatedAt, d.ModifiedBy, d.ModifiedAt);
}
