using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Abstractions;

public interface ICrewRepository
{
    Task<CrewListResponse> GetCrewListAsync(
        string? crewGroup,
        string? cluster,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<List<ActivityMasterAllActivitiesItemDto>> GetActivityMasterAllActivitiesAsync(
        CancellationToken ct = default);

    Task<List<CrewMasterItemDto>> GetCrewMasterAsync(
        CancellationToken ct = default);
    Task<CrewCalendarResponse> GetCrewCalendarAsync(
    string? cluster,
    string? site,
    string? wellType,
    string? project,
    DateOnly? from,
    DateOnly? to,
    CancellationToken ct = default);
}
