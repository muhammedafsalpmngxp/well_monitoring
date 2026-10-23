namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// Crew calendar backed by the materialised AlTasnimBI crew calendar result. It shares the legacy
/// contract so the existing calendar handlers and DTOs can serve either source unchanged.
/// </summary>
public interface ICrewCalendarService : ILegacyCrewCalendarService
{
    Task PreloadRosterAsync(CancellationToken ct = default);
}
