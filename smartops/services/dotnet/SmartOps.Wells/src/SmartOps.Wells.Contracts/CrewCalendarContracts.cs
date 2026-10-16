namespace SmartOps.Wells.Contracts;

// ─── Crew Calendar — nested hierarchy ───────────────────────────────────────
// Shape: CrewGroup[] → crewId[] → activities[]
// Also: Wells[] (flat list for reference/milestone association)

/// <summary>A single activity in the crew calendar / Gantt view.</summary>
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
    decimal? NormsPerDay,
    decimal? ProductivityPct);

/// <summary>A single crew member (crew_uid) with their activities.</summary>
public record CrewCalendarCrewDto(
    string CrewCode,
    IReadOnlyList<CrewCalendarActivityDto> Activities);

/// <summary>A crew group (crew_type / CREW_GROUP_CODE) with its crew members.</summary>
public record CrewCalendarGroupDto(
    string CrewGroupCode,
    int ActivityCount,
    decimal CompletionPct,
    IReadOnlyList<CrewCalendarCrewDto> Crews);

/// <summary>Response for GET /crews/calendar.</summary>
public record CrewCalendarResponse(
    int TotalGroups,
    int TotalCrews,
    int TotalActivities,
    int TotalMilestones,
    string FromDate,
    string ToDate,
    IReadOnlyList<CrewCalendarGroupDto> Groups,
    IReadOnlyList<CrewCalendarActivityDto> Milestones);
