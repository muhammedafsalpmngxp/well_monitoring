namespace TWise.Tenant.Domain.DTOs;

public sealed record DaxModelDto(
    long Id,
    string Name,
    string SourceType,
    string DataSource,
    string CalculatedBy,
    string? Operation,
    IReadOnlyList<string> Columns,
    string Expression,
    string Status,
    int UsedInCharts,
    DateTime CreatedAt,
    /// <summary>Who created the model; filled only for admins ("Unknown" for models saved before ownership).</summary>
    string? CreatedByName = null);

/// <summary>Body of POST /api/dax-models and PUT /api/dax-models/{id}.</summary>
public sealed record DaxModelSaveRequest(
    string Name,
    string SourceType,
    string DataSource,
    string CalculatedBy,
    string? Operation,
    IReadOnlyList<string>? Columns,
    string Expression,
    string? Status);

/// <summary>One page of models plus the totals shown in the cards above the table (unfiltered).</summary>
public sealed record DaxModelPageDto(
    IReadOnlyList<DaxModelDto> Items,
    int Total,
    int TotalModels,
    int FromTables,
    int FromViews);
