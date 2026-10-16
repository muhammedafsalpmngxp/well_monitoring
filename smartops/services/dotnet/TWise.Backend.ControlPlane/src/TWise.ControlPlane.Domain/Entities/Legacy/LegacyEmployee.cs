namespace TWise.Backend.ControlPlane.Domain.Entities.Legacy;

public class LegacyEmployee
{
    public int Id { get; set; }
    public string EmpUid { get; set; } = string.Empty;
    public string EmpName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public bool EmpStatus { get; set; }
    public int? LocationId { get; set; }
}
