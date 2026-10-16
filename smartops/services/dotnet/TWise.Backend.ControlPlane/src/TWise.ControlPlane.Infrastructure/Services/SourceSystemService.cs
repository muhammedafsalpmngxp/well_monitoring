using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class SourceSystemService(IGenericRepository<SourceSystem> repo) : ISourceSystemService
{
    public async Task<PagedResult<SourceSystemDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<SourceSystemDto>(
            paged.Items.Select(e => new SourceSystemDto(e.SourceSystemId, e.SourceCode, e.SourceName, e.SourceKind, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<SourceSystemDto?> GetAsync(int id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : new SourceSystemDto(e.SourceSystemId, e.SourceCode, e.SourceName, e.SourceKind, e.IsActive);
    }

    public async Task<SourceSystemDto> CreateAsync(SourceSystemCreateRequest request, CancellationToken ct)
    {
        var entity = new SourceSystem
        {
            SourceCode = request.SourceCode,
            SourceName = request.SourceName,
            SourceKind = request.SourceKind,
            IsActive = request.IsActive
        };
        var e = await repo.AddAsync(entity, ct);
        return new SourceSystemDto(e.SourceSystemId, e.SourceCode, e.SourceName, e.SourceKind, e.IsActive);
    }

    public async Task<bool> UpdateAsync(int id, SourceSystemUpdateRequest request, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;
        e.SourceCode = request.SourceCode;
        e.SourceName = request.SourceName;
        e.SourceKind = request.SourceKind;
        e.IsActive = request.IsActive;
        return await repo.UpdateAsync(id, e, ct);
    }

    public Task<bool> DeleteAsync(int id, CancellationToken ct) => repo.DeleteAsync(id, ct);
}
