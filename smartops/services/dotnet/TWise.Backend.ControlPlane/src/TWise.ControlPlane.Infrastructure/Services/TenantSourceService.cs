using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class TenantSourceService(IGenericRepository<TenantSource> repo) : ITenantSourceService
{
    public async Task<PagedResult<TenantSourceDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<TenantSourceDto>(
            paged.Items.Select(e => new TenantSourceDto(e.TenantSourceId, e.TenantId, e.SourceSystemId, e.ConnectionRef, e.IngestionMode, e.IsSystemOfRecord, e.Status, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<TenantSourceDto?> GetAsync(long id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : new TenantSourceDto(e.TenantSourceId, e.TenantId, e.SourceSystemId, e.ConnectionRef, e.IngestionMode, e.IsSystemOfRecord, e.Status, e.IsActive);
    }

    public async Task<TenantSourceDto> CreateAsync(TenantSourceCreateRequest request, CancellationToken ct)
    {
        var entity = new TenantSource
        {
            TenantId = request.TenantId,
            SourceSystemId = request.SourceSystemId,
            ConnectionRef = request.ConnectionRef,
            IngestionMode = request.IngestionMode,
            IsSystemOfRecord = request.IsSystemOfRecord,
            Status = request.Status,
            IsActive = request.IsActive
        };
        var e = await repo.AddAsync(entity, ct);
        return new TenantSourceDto(e.TenantSourceId, e.TenantId, e.SourceSystemId, e.ConnectionRef, e.IngestionMode, e.IsSystemOfRecord, e.Status, e.IsActive);
    }

    public async Task<bool> UpdateAsync(long id, TenantSourceUpdateRequest request, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;
        e.TenantId = request.TenantId;
        e.SourceSystemId = request.SourceSystemId;
        e.ConnectionRef = request.ConnectionRef;
        e.IngestionMode = request.IngestionMode;
        e.IsSystemOfRecord = request.IsSystemOfRecord;
        e.Status = request.Status;
        e.IsActive = request.IsActive;
        return await repo.UpdateAsync(id, e, ct);
    }

    public Task<bool> DeleteAsync(long id, CancellationToken ct) => repo.DeleteAsync(id, ct);
}
