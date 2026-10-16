namespace TWise.Tenant.Domain.DTOs;

// ─── Category DTOs ───────────────────────────────────────────────────────────

public class SaveCategoryRequest
{
    public string CategoryName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string ControlType { get; set; } = string.Empty;
}

public class CategoryResponse
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string ControlType { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}
