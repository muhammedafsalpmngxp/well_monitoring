using SmartOps.Shared.Db;

namespace SmartOps.Wells.Domain.Entities;

/// <summary>Geographical / operational cluster grouping multiple wells.</summary>
public class Cluster : AuditableEntity
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
    public int Total { get; set; }
    public int Ready { get; set; }
    public double Pct { get; set; }
}
