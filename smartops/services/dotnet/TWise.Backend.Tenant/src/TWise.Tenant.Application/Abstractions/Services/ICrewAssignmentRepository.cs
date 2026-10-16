using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface ICrewAssignmentRepository
{
    Task<bool> ExistsAsync(string crewUid, string activityCode, string? wellId,
        DateTime? plannedStart, DateTime? plannedEnd, CancellationToken ct = default);

    Task<CrewActivityAssignment?> CreateAsync(CrewActivityAssignment entity, CancellationToken ct = default);

    Task<CrewActivityAssignment?> GetByIdAsync(long id, CancellationToken ct = default);

    Task SoftDeleteAsync(CrewActivityAssignment entity, CancellationToken ct = default);

    Task<IReadOnlyList<CrewActivityAssignment>> GetForScopeAsync(
        string? crewGroupCode, string? wellId, DateTime? from = null, DateTime? to = null,
        CancellationToken ct = default);
}
