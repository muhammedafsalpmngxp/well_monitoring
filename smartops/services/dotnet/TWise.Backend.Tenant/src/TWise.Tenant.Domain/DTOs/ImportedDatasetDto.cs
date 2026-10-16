namespace TWise.Tenant.Domain.DTOs;

// ── ImportedDataset DTOs ────────────────────────────────────────────────────

public record ImportColumnDto(string Name, string Type);

public record ImportedDatasetDto(
    long Id,
    string DatasetName,
    string FileName,
    string FileType,
    IReadOnlyList<ImportColumnDto> Columns,
    int RowCount,
    string Status,
    string? ErrorMessage,
    long TenantId,
    long CreatedBy,
    DateTime CreatedAt,
    long? ModifiedBy,
    DateTime ModifiedAt
);

public record ImportedDatasetListDto(
    long Id,
    string DatasetName,
    string FileName,
    string FileType,
    int RowCount,
    string Status,
    DateTime CreatedAt
);

public record ImportedDatasetDataResponse(
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, object?>> Rows,
    int TotalRows
);
