namespace TWise.Tenant.Domain.DTOs;

/// <summary>Request to assign an activity to a crew (persisted in the tenant DB).</summary>
public record CreateCrewAssignmentRequest(
    string CrewGroupCode,
    string CrewUid,
    string? CrewTypeCode,
    string ActivityCode,
    string ActivityName,
    string? WellId,
    string? ProjectId,
    DateTime? PlannedStart,
    DateTime? PlannedEnd);

public record CrewAssignmentResponse(
    long Id,
    string CrewGroupCode,
    string CrewUid,
    string? CrewTypeCode,
    string ActivityCode,
    string ActivityName,
    string? WellId,
    string? ProjectId,
    DateTime? PlannedStart,
    DateTime? PlannedEnd,
    decimal Progress,
    string Status,
    string Message);
