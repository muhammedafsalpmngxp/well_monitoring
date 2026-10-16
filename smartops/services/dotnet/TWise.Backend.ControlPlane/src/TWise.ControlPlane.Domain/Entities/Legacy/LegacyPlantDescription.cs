namespace TWise.Backend.ControlPlane.Domain.Entities.Legacy;

public class LegacyPlantDescription
{
    public int PlantCode { get; set; }
    public string PlantDesc { get; set; } = string.Empty;
    public string Cluster { get; set; } = string.Empty;
    public string Division { get; set; } = string.Empty;
    public string BusinessUnit { get; set; } = string.Empty;
    public string Sector { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;
}
