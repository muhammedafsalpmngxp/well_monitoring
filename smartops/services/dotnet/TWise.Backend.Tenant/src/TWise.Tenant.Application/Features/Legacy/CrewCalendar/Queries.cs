using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs.Legacy;

namespace TWise.Tenant.Application.Features.Legacy.CrewCalendar;

public record GetCrewCalendarQuery(
    string? Cluster = null,
    string? Site = null,
    string? WellType = null,
    string? Project = null,
    string? From = null,
    string? To = null,
    bool IncludeAssignments = false,
    bool IncludeRoster = false) : IRequest<Result<CrewCalendarResponse>>;

public record GetUnassignedCrewsQuery(
    string? CrewGroup = null,
    string? From = null,
    string? To = null) : IRequest<Result<UnassignedCrewsResponse>>;

public record GetAssignableActivitiesQuery(
    string? CrewGroup = null,
    string? CrewTypeCode = null) : IRequest<Result<AssignableActivitiesResponse>>;
