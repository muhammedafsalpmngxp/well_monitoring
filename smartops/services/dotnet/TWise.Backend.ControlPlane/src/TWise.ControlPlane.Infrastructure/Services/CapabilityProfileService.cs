using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class CapabilityProfileService(IGenericRepository<CapabilityProfile> repo) : ICapabilityProfileService
{
    public async Task<PagedResult<CapabilityProfileDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await repo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<CapabilityProfileDto>(
            paged.Items.Select(e => new CapabilityProfileDto(e.CapabilityId, e.TenantSourceId, e.CanonicalFieldId, e.IsAvailable, e.Note, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<CapabilityProfileDto?> GetAsync(long id, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        return e is null ? null : new CapabilityProfileDto(e.CapabilityId, e.TenantSourceId, e.CanonicalFieldId, e.IsAvailable, e.Note, e.IsActive);
    }

    public async Task<CapabilityProfileDto> CreateAsync(CapabilityProfileCreateRequest request, CancellationToken ct)
    {
        var entity = new CapabilityProfile
        {
            TenantSourceId = request.TenantSourceId,
            CanonicalFieldId = request.CanonicalFieldId,
            IsAvailable = request.IsAvailable,
            Note = request.Note,
            IsActive = request.IsActive
        };
        var e = await repo.AddAsync(entity, ct);
        return new CapabilityProfileDto(e.CapabilityId, e.TenantSourceId, e.CanonicalFieldId, e.IsAvailable, e.Note, e.IsActive);
    }

    public async Task<bool> UpdateAsync(long id, CapabilityProfileUpdateRequest request, CancellationToken ct)
    {
        var e = await repo.GetAsync(id, ct);
        if (e is null) return false;
        e.TenantSourceId = request.TenantSourceId;
        e.CanonicalFieldId = request.CanonicalFieldId;
        e.IsAvailable = request.IsAvailable;
        e.Note = request.Note;
        e.IsActive = request.IsActive;
        return await repo.UpdateAsync(id, e, ct);
    }

    public Task<bool> DeleteAsync(long id, CancellationToken ct) => repo.DeleteAsync(id, ct);
}
