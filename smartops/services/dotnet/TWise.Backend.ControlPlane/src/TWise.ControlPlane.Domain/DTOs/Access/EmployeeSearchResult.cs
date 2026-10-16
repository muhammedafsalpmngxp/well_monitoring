namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record EmployeeSearchResult(
    string EmployeeId,
    string DisplayName,
    string? Email,
    IReadOnlyList<EmployeePlantAccess> PlantAccess);

public record EmployeePlantAccess(
    int PlantCode,
    string PlantName,
    string Cluster,
    string Division,
    string BusinessUnit,
    string Sector,
    string Country);
