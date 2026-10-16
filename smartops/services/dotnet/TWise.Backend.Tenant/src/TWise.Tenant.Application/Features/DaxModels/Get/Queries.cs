using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DaxModels;

/// <summary>Admins (IsAdmin) see every user's models with the creator's name; everyone else sees only the ones they created.</summary>
public sealed record ListDaxModelsQuery(string? Search, string? Status, int? SinceDays, long UserId, bool IsAdmin, long TenantId, int Page = 1, int PageSize = 20)
    : IRequest<DaxModelPageDto>;
