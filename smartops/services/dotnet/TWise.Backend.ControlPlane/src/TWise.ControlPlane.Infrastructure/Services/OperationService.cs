using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class OperationService(
    IGenericRepository<IngestionRun> ingestionRunRepo,
    IGenericRepository<AuditEvent> auditEventRepo) : IOperationService
{
    // ─── IngestionRun ────────────────────────────────────────────────────────

    public async Task<PagedResult<IngestionRunDto>> ListIngestionRunsAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await ingestionRunRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<IngestionRunDto>(
            paged.Items.Select(e => new IngestionRunDto(e.IngestionRunId, e.TenantSourceId, e.StartedAt, e.FinishedAt, e.Status, e.RowsExtracted, e.RowsLoaded, e.ErrorCount)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<IngestionRunDto?> GetIngestionRunAsync(long id, CancellationToken ct)
    {
        var e = await ingestionRunRepo.GetAsync(id, ct);
        return e is null ? null : new IngestionRunDto(e.IngestionRunId, e.TenantSourceId, e.StartedAt, e.FinishedAt, e.Status, e.RowsExtracted, e.RowsLoaded, e.ErrorCount);
    }

    public async Task<IngestionRunDto> CreateIngestionRunAsync(IngestionRunCreateRequest request, CancellationToken ct)
    {
        var entity = new IngestionRun
        {
            TenantSourceId = request.TenantSourceId,
            StartedAt = request.StartedAt,
            FinishedAt = request.FinishedAt,
            Status = request.Status,
            RowsExtracted = request.RowsExtracted,
            RowsLoaded = request.RowsLoaded,
            ErrorCount = request.ErrorCount
        };
        var e = await ingestionRunRepo.AddAsync(entity, ct);
        return new IngestionRunDto(e.IngestionRunId, e.TenantSourceId, e.StartedAt, e.FinishedAt, e.Status, e.RowsExtracted, e.RowsLoaded, e.ErrorCount);
    }

    public async Task<bool> UpdateIngestionRunAsync(long id, IngestionRunUpdateRequest request, CancellationToken ct)
    {
        var e = await ingestionRunRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantSourceId = request.TenantSourceId;
        e.StartedAt = request.StartedAt;
        e.FinishedAt = request.FinishedAt;
        e.Status = request.Status;
        e.RowsExtracted = request.RowsExtracted;
        e.RowsLoaded = request.RowsLoaded;
        e.ErrorCount = request.ErrorCount;

        return await ingestionRunRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteIngestionRunAsync(long id, CancellationToken ct)
    {
        return await ingestionRunRepo.DeleteAsync(id, ct);
    }

    // ─── AuditEvent ──────────────────────────────────────────────────────────

    public async Task<PagedResult<AuditEventDto>> ListAuditEventsAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await auditEventRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<AuditEventDto>(
            paged.Items.Select(e => new AuditEventDto(e.AuditEventId, e.TenantId, e.UserId, e.Action, e.Entity, e.Detail, e.OccurredAt)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<AuditEventDto?> GetAuditEventAsync(long id, CancellationToken ct)
    {
        var e = await auditEventRepo.GetAsync(id, ct);
        return e is null ? null : new AuditEventDto(e.AuditEventId, e.TenantId, e.UserId, e.Action, e.Entity, e.Detail, e.OccurredAt);
    }

    public async Task<AuditEventDto> CreateAuditEventAsync(AuditEventCreateRequest request, CancellationToken ct)
    {
        var entity = new AuditEvent
        {
            TenantId = request.TenantId,
            UserId = request.UserId,
            Action = request.Action,
            Entity = request.Entity,
            Detail = request.Detail,
            OccurredAt = request.OccurredAt
        };
        var e = await auditEventRepo.AddAsync(entity, ct);
        return new AuditEventDto(e.AuditEventId, e.TenantId, e.UserId, e.Action, e.Entity, e.Detail, e.OccurredAt);
    }

    public async Task<bool> UpdateAuditEventAsync(long id, AuditEventUpdateRequest request, CancellationToken ct)
    {
        var e = await auditEventRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantId = request.TenantId;
        e.UserId = request.UserId;
        e.Action = request.Action;
        e.Entity = request.Entity;
        e.Detail = request.Detail;
        e.OccurredAt = request.OccurredAt;

        return await auditEventRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteAuditEventAsync(long id, CancellationToken ct)
    {
        return await auditEventRepo.DeleteAsync(id, ct);
    }
}
