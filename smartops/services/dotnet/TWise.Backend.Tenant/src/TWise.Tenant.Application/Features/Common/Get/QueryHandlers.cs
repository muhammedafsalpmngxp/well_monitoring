using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Common;

public sealed class ListSourcesHandler(ISourceService svc)
    : IRequestHandler<ListSourcesQuery, IReadOnlyList<SourceDto>>
{
    public Task<IReadOnlyList<SourceDto>> Handle(ListSourcesQuery request, CancellationToken cancellationToken)
        => svc.ListSourcesAsync(cancellationToken);
}

public sealed class ListBISourcesHandler(ISourceService svc)
    : IRequestHandler<ListBISourcesQuery, IReadOnlyList<SourceDto>>
{
    public Task<IReadOnlyList<SourceDto>> Handle(ListBISourcesQuery request, CancellationToken cancellationToken)
        => svc.ListBITablesAsync(cancellationToken);
}

public sealed class GetTableDataHandler(ISourceService svc)
    : IRequestHandler<GetTableDataQuery, TableDataDto?>
{
    public Task<TableDataDto?> Handle(GetTableDataQuery request, CancellationToken cancellationToken)
        => svc.GetTableDataAsync(request.SourceName, request.SourceType, cancellationToken);
}

public sealed class GetAggregateHandler(ISourceService svc)
    : IRequestHandler<GetAggregateQuery, AggregateResultDto?>
{
    public Task<AggregateResultDto?> Handle(GetAggregateQuery request, CancellationToken cancellationToken)
        => svc.GetAggregateAsync(request.Request, cancellationToken);
}

public sealed class GetFilteredChartDataHandler(ISourceService svc)
    : IRequestHandler<GetFilteredChartDataQuery, TableDataDto?>
{
    public Task<TableDataDto?> Handle(GetFilteredChartDataQuery request, CancellationToken cancellationToken)
        => svc.GetFilteredChartDataAsync(request.Request, cancellationToken);
}

public sealed class GetPlantFiltersHandler(ISourceService svc, ICurrentUserService currentUser)
    : IRequestHandler<GetPlantFiltersQuery, IReadOnlyList<PlantFilterDto>>
{
    public async Task<IReadOnlyList<PlantFilterDto>> Handle(GetPlantFiltersQuery request, CancellationToken cancellationToken)
    {
        var plants = await svc.GetPlantFiltersAsync(cancellationToken);

        // Anonymous (externally shared dashboard) and admin users see every plant;
        // everyone else is scoped to only the plants assigned to them (Plant Access).
        if (currentUser.UserId is null || string.Equals(currentUser.Role, "admin", StringComparison.OrdinalIgnoreCase))
            return plants;

        var allowed = currentUser.PlantCodes;
        if (allowed.Count == 0) return plants;

        var allowedSet = new HashSet<int>(allowed);
        return plants.Where(p => allowedSet.Contains(p.PlantCode)).ToList();
    }
}

public sealed class GetAdvancedFilterDataHandler(ISourceService svc)
    : IRequestHandler<GetAdvancedFilterDataQuery, AdvancedFilterDataDto>
{
    public Task<AdvancedFilterDataDto> Handle(GetAdvancedFilterDataQuery request, CancellationToken cancellationToken)
        => svc.GetAdvancedFilterDataAsync(cancellationToken);
}
