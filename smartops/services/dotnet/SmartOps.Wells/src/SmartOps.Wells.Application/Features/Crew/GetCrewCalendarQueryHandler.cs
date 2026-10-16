using MediatR;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.Crew;

/// <summary>
/// Handler for <see cref="GetCrewCalendarQuery"/>.
/// Delegates data access to the repository and returns the crew calendar response.
/// </summary>
public sealed class GetCrewCalendarQueryHandler(ICrewRepository repo)
    : IRequestHandler<GetCrewCalendarQuery, CrewCalendarResponse>
{
    public Task<CrewCalendarResponse> Handle(
        GetCrewCalendarQuery request, CancellationToken ct)
        => repo.GetCrewCalendarAsync(
            request.Cluster,
            request.Site,
            request.WellType,
            request.Project,
            request.From,
            request.To,
            ct);
}
