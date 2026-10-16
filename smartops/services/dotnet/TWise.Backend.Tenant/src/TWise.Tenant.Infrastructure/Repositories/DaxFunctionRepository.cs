using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

/// <summary>Reads the DAX function catalog (dbo.DaxFunction) through dbo.usp_DaxSuggest.</summary>
public sealed class DaxFunctionRepository(TenantDbContext db) : IDaxFunctionRepository
{
    public async Task<IReadOnlyList<DaxFunctionSuggestionDto>> SuggestAsync(string prefix, string? returnType, int top, CancellationToken ct = default)
        // Interpolated values are sent as parameters, not concatenated into the SQL.
        => await db.Database
            .SqlQuery<DaxFunctionSuggestionDto>($"EXEC dbo.usp_DaxSuggest @Prefix = {prefix}, @ReturnType = {returnType}, @Top = {top}")
            .ToListAsync(ct);
}
