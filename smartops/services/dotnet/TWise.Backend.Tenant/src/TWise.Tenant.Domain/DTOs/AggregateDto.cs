using System.Text.Json;

namespace TWise.Tenant.Domain.DTOs;

/// <summary>
/// Request to compute a single aggregate value server-side (in SQL) for a table/view source,
/// so tiles on multi-million-row tables show the correct number instead of a browser-side
/// count over the first 1000 rows.
/// </summary>
public record AggregateRequestDto(
    string SourceName,
    string SourceType,
    string Aggregation,          // count | countDistinct | total (sum) | average | value
    string? ValueField = null,   // required for everything except a plain count
    TileDaxRequestDto? Dax = null
);

public record TileDaxRequestDto(JsonElement Expression, string? Scope = null);

/// <summary>The single aggregated number (null when the source/column can't be resolved).</summary>
public record AggregateResultDto(double? Value);
