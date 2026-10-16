using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions;

public interface IDaxFunctionRepository
{
    /// <summary>Enabled functions matching a prefix, best first (dbo.usp_DaxSuggest).</summary>
    Task<IReadOnlyList<DaxFunctionSuggestionDto>> SuggestAsync(string prefix, string? returnType, int top, CancellationToken ct = default);
}
