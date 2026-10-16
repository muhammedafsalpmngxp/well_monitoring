namespace TWise.Tenant.Domain.DTOs;

/// <summary>
/// Metadata options returned by the API for the View Builder UI dropdowns.
/// Provides all available join types, filter operators, and logical connectors.
/// </summary>
public record ViewBuilderOptionsResponse(
    IReadOnlyList<ViewBuilderEnumOption> JoinTypes,
    IReadOnlyList<ViewBuilderEnumOption> FilterOperators,
    IReadOnlyList<ViewBuilderEnumOption> LogicalConnectors,
    IReadOnlyList<ViewBuilderEnumOption> SortDirections
);

public record ViewBuilderEnumOption(
    string Value,
    string Label,
    string? Description = null
);
