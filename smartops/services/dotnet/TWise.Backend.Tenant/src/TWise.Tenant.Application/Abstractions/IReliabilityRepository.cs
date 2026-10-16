using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IReliabilityRepository
{
    Task<TableReliabilityDto> GetTableReliabilityAsync(string tableName, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DataRule>> GetScoredRulesAsync(CancellationToken cancellationToken = default);
}