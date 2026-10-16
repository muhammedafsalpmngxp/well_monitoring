using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IReportTemplateRepository
{
    Task<List<ReportTemplate>> GetBySourceAsync(string? sourceName, string? sourceType, string type, string? customName, long userId, CancellationToken ct = default);
    Task<ReportTemplate> UpsertAsync(string customName, string sourceName, string sourceType, string templateJson, string type, long? viewId, long userId, long tenantId, CancellationToken ct = default);
}
