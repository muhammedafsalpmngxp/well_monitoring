using MediatR;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.Crew;

/// <summary>
/// Query to retrieve crew calendar timeline data from ActivityTaskPlan.
/// All filter parameters are optional; when omitted, returns all crews in the date window.
/// </summary>
public record GetCrewCalendarQuery(
    string?   Cluster,
    string?   Site,
    string?   WellType,
    string?   Project,
    DateOnly? From,
    DateOnly? To)
    : IRequest<CrewCalendarResponse>;
