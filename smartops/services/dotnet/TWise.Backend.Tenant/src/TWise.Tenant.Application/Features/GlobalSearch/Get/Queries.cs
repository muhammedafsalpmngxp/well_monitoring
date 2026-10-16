using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.GlobalSearch;

/// <summary>Searches boards (dashboards), charts, tiles and reports by name for the current user.</summary>
public record GlobalSearchQuery(string SearchTerm) : IRequest<Result<IReadOnlyList<GlobalSearchResultItem>>>;
