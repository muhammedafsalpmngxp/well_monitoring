using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ILegacyDirectoryService
{
    Task<IReadOnlyList<EmployeeSearchResult>> SearchEmployeesAsync(string term, CancellationToken ct);
    Task<IReadOnlyList<EmployeePlantAccess>> ListPlantsAsync(CancellationToken ct);
}
