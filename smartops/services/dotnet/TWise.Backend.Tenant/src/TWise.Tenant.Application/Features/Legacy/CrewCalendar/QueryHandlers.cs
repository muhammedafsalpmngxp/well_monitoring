using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs.Legacy;

namespace TWise.Tenant.Application.Features.Legacy.CrewCalendar;

public sealed class GetCrewCalendarHandler(
    ILegacyCrewCalendarService service,
    ILogger<GetCrewCalendarHandler> logger)
    : IRequestHandler<GetCrewCalendarQuery, Result<CrewCalendarResponse>>
{
    public async Task<Result<CrewCalendarResponse>> Handle(
        GetCrewCalendarQuery request, CancellationToken ct)
    {
        logger.LogInformation("Legacy crew calendar query: cluster={Cluster} site={Site}",
            request.Cluster, request.Site);

        DateOnly? from = DateOnly.TryParse(request.From, out var f) ? f : null;
        DateOnly? to = DateOnly.TryParse(request.To, out var t) ? t : null;

        var result = await service.GetCrewCalendarAsync(
            request.Cluster, request.Site, request.WellType,
            request.Project, from, to, request.IncludeAssignments, ct);

        if (request.IncludeRoster)
        {
            var rosterFrom = DateOnly.Parse(result.FromDate);
            var rosterTo = DateOnly.Parse(result.ToDate);
            var candidates = result.Groups.SelectMany(group => group.Crews)
                .Where(crew => string.IsNullOrWhiteSpace(crew.CrewCode))
                .SelectMany(crew => crew.Activities)
                .Where(activity => !activity.IsMilestone && activity.Progress == 0 &&
                    string.IsNullOrEmpty(activity.ActualStart) && string.IsNullOrEmpty(activity.ActualEnd));
            foreach (var activity in candidates)
            {
                if (!DateOnly.TryParse(activity.PlannedStart, out var start) ||
                    !DateOnly.TryParse(activity.PlannedEnd, out var end) || end < start) continue;
                if (start < rosterFrom) rosterFrom = start;
                if (end > rosterTo) rosterTo = end;
            }
            result = result with
            {
                Roster = await service.GetCrewRosterAsync(rosterFrom, rosterTo, ct, request.IncludeAssignments)
            };
        }

        return Result<CrewCalendarResponse>.Success(result);
    }
}

public sealed class GetUnassignedCrewsHandler(
    ILegacyCrewCalendarService service,
    ILogger<GetUnassignedCrewsHandler> logger)
    : IRequestHandler<GetUnassignedCrewsQuery, Result<UnassignedCrewsResponse>>
{
    public async Task<Result<UnassignedCrewsResponse>> Handle(
        GetUnassignedCrewsQuery request, CancellationToken ct)
    {
        logger.LogInformation("Legacy unassigned crews query: crewGroup={CrewGroup}", request.CrewGroup);

        DateOnly? from = DateOnly.TryParse(request.From, out var f) ? f : null;
        DateOnly? to = DateOnly.TryParse(request.To, out var t) ? t : null;

        var result = await service.GetUnassignedCrewsAsync(request.CrewGroup, from, to, ct);

        return Result<UnassignedCrewsResponse>.Success(result);
    }
}

public sealed class GetAssignableActivitiesHandler(
    ILegacyCrewCalendarService service,
    ILogger<GetAssignableActivitiesHandler> logger)
    : IRequestHandler<GetAssignableActivitiesQuery, Result<AssignableActivitiesResponse>>
{
    public async Task<Result<AssignableActivitiesResponse>> Handle(
        GetAssignableActivitiesQuery request, CancellationToken ct)
    {
        logger.LogInformation("Legacy assignable activities query: crewGroup={CrewGroup} crewTypeCode={CrewTypeCode}",
            request.CrewGroup, request.CrewTypeCode);

        var result = await service.GetAssignableActivitiesAsync(request.CrewGroup, request.CrewTypeCode, ct);

        return Result<AssignableActivitiesResponse>.Success(result);
    }
}
