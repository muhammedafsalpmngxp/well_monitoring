namespace TWise.Tenant.Domain.DTOs;

// ── Data dictionary ──────────────────────────────────────────────────────────

/// <summary>One dataset in the dictionary list, with documentation coverage.</summary>
public sealed record DictionaryDatasetDto(
    string Kind,
    long Id,
    string Name,
    string? Description,
    string? Owner,
    int ColumnCount,
    int DocumentedCount,
    int PiiCount);

public sealed record DictionaryColumnDto(
    string ColumnName,
    string DataType,
    string? BusinessName,
    string? Description,
    string? Owner,
    string Sensitivity,
    string? Tags);

public sealed record DictionaryDatasetDetailDto(
    string Kind,
    long Id,
    string Name,
    string? Description,
    string? Owner,
    IReadOnlyList<DictionaryColumnDto> Columns);

public sealed record SaveDictionaryColumnRequest(
    string ColumnName,
    string? BusinessName,
    string? Description,
    string? Owner,
    string? Sensitivity,
    string? Tags);

public sealed record SaveDictionaryRequest(
    string? Description,
    string? Owner,
    IReadOnlyList<SaveDictionaryColumnRequest> Columns);

/// <summary>The AI's draft documentation for a dataset. Nothing is saved: an admin reviews it in the editor and saves.</summary>
public sealed record DictionaryDraftDto(string? Description, IReadOnlyList<DictionaryColumnDraftDto> Columns);

/// <summary>One column's draft; Sensitivity is public | internal | confidential | pii.</summary>
public sealed record DictionaryColumnDraftDto(string ColumnName, string? BusinessName, string? Description, string Sensitivity, string? Tags);

// ── Lineage ──────────────────────────────────────────────────────────────────

/// <summary>Kind is one of: source, db, import, view, table, chart, dashboard, report.</summary>
public sealed record LineageNodeDto(string Id, string Kind, string Label, string? Sub);

public sealed record LineageEdgeDto(string From, string To);

public sealed record LineageGraphDto(IReadOnlyList<LineageNodeDto> Nodes, IReadOnlyList<LineageEdgeDto> Edges);
