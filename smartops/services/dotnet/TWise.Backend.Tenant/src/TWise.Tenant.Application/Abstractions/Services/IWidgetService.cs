using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IWidgetService
{
    Task<IReadOnlyList<WidgetDto>> GetAllAsync(string? status, string? type, long userId, bool isAdmin, CancellationToken ct = default);
    Task<WidgetDto?> GetByIdAsync(long id, long userId, CancellationToken ct = default);
    Task<WidgetDto> CreateAsync(CreateWidgetRequest request, long userId, long tenantId, CancellationToken ct = default);
    Task<WidgetDto?> CopyToDraftAsync(long id, long userId, bool isAdmin, long tenantId, CancellationToken ct = default);
    Task<WidgetDto?> UpdateAsync(long id, UpdateWidgetRequest request, long userId, bool isAdmin, CancellationToken ct = default);
    Task<bool> DeleteAsync(long id, long userId, CancellationToken ct = default);
}
