using TWise.Tenant.Domain.DTOs.Legacy;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <remarks>LEGACY: reads from AppMasterDB. Remove when data migrates to tenant DB.</remarks>
public interface ILegacyCrewCalendarService
{
    Task<CrewCalendarResponse> GetCrewCalendarAsync(
        string? cluster, string? site, string? wellType, string? project,
        DateOnly? from, DateOnly? to, bool includeAssignments = false, CancellationToken ct = default);

    Task<UnassignedCrewsResponse> GetUnassignedCrewsAsync(
        string? crewGroup, DateOnly? from, DateOnly? to, CancellationToken ct = default);

    Task<CrewRosterResponse> GetCrewRosterAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default, bool includeAssignments = true);

    Task<AssignableActivitiesResponse> GetAssignableActivitiesAsync(
        string? crewGroup, string? crewTypeCode, CancellationToken ct = default);
}
