using MediatR;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.Crew;

public record GetCrewListQuery(
    string? CrewGroup,
    string? Cluster,
    string? WellId,
    DateOnly? From,
    DateOnly? To,
    int Page = 1,
    int PageSize = 50)
    : IRequest<CrewListResponse>;

public sealed class GetCrewListQueryHandler(ICrewRepository repo)
    : IRequestHandler<GetCrewListQuery, CrewListResponse>
{
    public Task<CrewListResponse> Handle(GetCrewListQuery request, CancellationToken ct)
        => repo.GetCrewListAsync(
            request.CrewGroup,
            request.Cluster,
            request.WellId,
            request.From,
            request.To,
            request.Page,
            request.PageSize,
            ct);
}

public record GetActivityMasterAllActivitiesQuery()
    : IRequest<IReadOnlyList<ActivityMasterAllActivitiesItemDto>>;

public record GetCrewMasterQuery()
    : IRequest<IReadOnlyList<CrewMasterItemDto>>;

public sealed class GetCrewMasterQueryHandler(ICrewRepository repo)
    : IRequestHandler<GetCrewMasterQuery, IReadOnlyList<CrewMasterItemDto>>
{
    public async Task<IReadOnlyList<CrewMasterItemDto>> Handle(
        GetCrewMasterQuery request,
        CancellationToken ct)
        => await repo.GetCrewMasterAsync(ct);
}

public sealed class GetActivityMasterAllActivitiesQueryHandler(ICrewRepository repo)
    : IRequestHandler<GetActivityMasterAllActivitiesQuery, IReadOnlyList<ActivityMasterAllActivitiesItemDto>>
{
    public async Task<IReadOnlyList<ActivityMasterAllActivitiesItemDto>> Handle(
        GetActivityMasterAllActivitiesQuery request,
        CancellationToken ct)
        => await repo.GetActivityMasterAllActivitiesAsync(ct);
}
