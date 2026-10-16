namespace TWise.Tenant.Domain.DTOs;

/// <summary>One matched item returned by the global search across boards, charts, tiles and reports.</summary>
public record GlobalSearchResultItem(
    string Type,          // "dashboard" | "chart" | "tile" | "report"
    string Id,
    string Name,
    string? CategoryName,
    string Status,
    string Url            // frontend route to the item's detail page
);
