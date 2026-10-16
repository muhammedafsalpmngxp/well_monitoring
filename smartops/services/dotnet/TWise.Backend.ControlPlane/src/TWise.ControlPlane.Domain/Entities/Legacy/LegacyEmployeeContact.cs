namespace TWise.Backend.ControlPlane.Domain.Entities.Legacy;

public class LegacyEmployeeContact
{
    public int EmployeeContactId { get; set; }
    public int PersonnelNumber { get; set; }
    public string EmployeeName { get; set; } = string.Empty;
    public string? PersonnelArea { get; set; }
    public string? MobileNumber { get; set; }
    public int ClusterId { get; set; }
}
