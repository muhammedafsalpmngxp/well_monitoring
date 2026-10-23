namespace TWise.Tenant.Domain.DTOs.Legacy;

public record CrewCalendarActivityDto(
    string ActivityCode,
    string ActivityName,
    string WellId,
    string? Category,
    string PlannedStart,
    string PlannedEnd,
    string? ActualStart,
    string? ActualEnd,
    decimal Progress,
    string Status,
    bool IsMilestone,
    string? RigOnDate,
    string? ExpectedRigOnDate,
    decimal? NormsPerDay = null,
    decimal? ProductivityPct = null,
    string Source = "legacy",
    long? AssignmentId = null,
    string? Cluster = null,
    int? PlantCode = null);

public record CrewCalendarCrewDto(
    string CrewCode,
    IReadOnlyList<CrewCalendarActivityDto> Activities);

public record CrewCalendarGroupDto(
    string CrewGroupCode,
    int ActivityCount,
    decimal CompletionPct,
    IReadOnlyList<CrewCalendarCrewDto> Crews,
    string? CrewGroupName = null);

public record CrewActualWorkDto(
    string CrewGroupCode,
    string CrewCode,
    string ActualStart,
    string? ActualEnd);

public record CrewCalendarResponse(
    int TotalGroups,
    int TotalCrews,
    int TotalActivities,
    int TotalMilestones,
    string FromDate,
    string ToDate,
    IReadOnlyList<CrewCalendarGroupDto> Groups,
    IReadOnlyList<CrewCalendarActivityDto> Milestones,
    CrewRosterResponse? Roster = null,
    IReadOnlyList<CrewActualWorkDto>? ActualCrewWork = null,
    IReadOnlyList<CrewCalendarGroupDto>? ActualGroups = null);

public record CrewBookingDto(string PlannedStart, string PlannedEnd);

public record CrewProjectMappingDto(string ProjectId, string? ProjectCode, string? Cluster);

public record CrewRosterMemberDto(
    string CrewUid,
    string? CrewTypeCode,
    IReadOnlyList<CrewBookingDto> Bookings,
    IReadOnlyList<CrewProjectMappingDto>? Projects = null);

public record CrewRosterGroupDto(
    string CrewGroupCode,
    string? CrewGroupName,
    IReadOnlyList<CrewRosterMemberDto> Crews);

public record CrewRosterResponse(IReadOnlyList<CrewRosterGroupDto> Groups);

public record UnassignedCrewDto(
    string CrewUid,
    string? CrewTypeCode);

public record UnassignedCrewGroupDto(
    string CrewGroupCode,
    string? CrewGroupName,
    IReadOnlyList<UnassignedCrewDto> Crews);

public record UnassignedCrewsResponse(
    int TotalGroups,
    int TotalCrews,
    IReadOnlyList<UnassignedCrewGroupDto> Groups);

public record AssignableActivityDto(
    string ActivityCode,
    string ActivityName,
    string? CrewGroupCode,
    string? CrewTypeCode,
    string? Discipline,
    string? Uom,
    decimal? Norm);

public record AssignableActivitiesResponse(
    int Total,
    IReadOnlyList<AssignableActivityDto> Activities);
