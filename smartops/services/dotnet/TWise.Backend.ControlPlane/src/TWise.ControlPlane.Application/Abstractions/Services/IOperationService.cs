using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface IOperationService
{
    Task<PagedResult<IngestionRunDto>> ListIngestionRunsAsync(int page, int pageSize, CancellationToken ct);
    Task<IngestionRunDto?> GetIngestionRunAsync(long id, CancellationToken ct);
    Task<IngestionRunDto> CreateIngestionRunAsync(IngestionRunCreateRequest request, CancellationToken ct);
    Task<bool> UpdateIngestionRunAsync(long id, IngestionRunUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteIngestionRunAsync(long id, CancellationToken ct);

    Task<PagedResult<AuditEventDto>> ListAuditEventsAsync(int page, int pageSize, CancellationToken ct);
    Task<AuditEventDto?> GetAuditEventAsync(long id, CancellationToken ct);
    Task<AuditEventDto> CreateAuditEventAsync(AuditEventCreateRequest request, CancellationToken ct);
    Task<bool> UpdateAuditEventAsync(long id, AuditEventUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteAuditEventAsync(long id, CancellationToken ct);
}
