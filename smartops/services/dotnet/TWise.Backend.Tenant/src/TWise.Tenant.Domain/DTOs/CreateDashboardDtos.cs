namespace TWise.Tenant.Domain.DTOs;

/// <summary>
/// Shared request for Create and Update dashboard.
/// All fields validated the same way on both operations.
/// </summary>
public class SaveDashboardRequest
{
    public string DashboardName { get; set; } = string.Empty;
    public int CategoryId { get; set; }
    public string? Description { get; set; }
    public string? ConfigJson { get; set; }
}

public class PatchDashboardLayoutRequest
{
    public string ConfigJson { get; set; } = string.Empty;
}

public class ShareDashboardInternallyRequest
{
    public List<long> UserIds { get; set; } = new();
}

/// <summary>
/// Response after successful dashboard creation.
/// </summary>
public class CreateDashboardResponse
{
    public int DashboardId { get; set; }
    public string DashboardName { get; set; } = string.Empty;
    public int CategoryId { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}
