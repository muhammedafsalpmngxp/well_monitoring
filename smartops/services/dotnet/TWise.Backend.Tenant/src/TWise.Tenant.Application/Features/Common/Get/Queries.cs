using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Common;

/// <summary>Returns all tables and views in the core schema — used to populate SourceName/SourceType dropdowns.</summary>
public record ListSourcesQuery : IRequest<IReadOnlyList<SourceDto>>;

/// <summary>Returns all tables from the AlTasnimBI database — temporary.</summary>
public record ListBISourcesQuery : IRequest<IReadOnlyList<SourceDto>>;

/// <summary>Returns full data (columns + rows) from a core schema table or view for live preview.</summary>
public record GetTableDataQuery(string SourceName, string SourceType) : IRequest<TableDataDto?>;

/// <summary>Computes a single aggregate value in SQL (server-side) for a table/view source.</summary>
public record GetAggregateQuery(AggregateRequestDto Request) : IRequest<AggregateResultDto?>;

public record GetFilteredChartDataQuery(ChartFilteredDataRequest Request) : IRequest<TableDataDto?>;

public record GetPlantFiltersQuery : IRequest<IReadOnlyList<PlantFilterDto>>;

public record GetAdvancedFilterDataQuery : IRequest<AdvancedFilterDataDto>;
