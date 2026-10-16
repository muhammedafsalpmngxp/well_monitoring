namespace TWise.Tenant.Domain.DTOs;

// ─── Widget Library (for Dashboard Builder sidebar) ──────────────────────────

public class WidgetLibraryResponse
{
    public List<WidgetLibraryItem> Tiles { get; set; } = new();
    public List<WidgetLibraryItem> Charts { get; set; } = new();
}

public class WidgetLibraryItem
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Type { get; set; } = string.Empty;
    public int? LibraryId { get; set; }
    public string Source { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string? DesignJson { get; set; }
    public string Status { get; set; } = string.Empty;
    public int? CategoryId { get; set; }
    public string? CategoryName { get; set; }
}
