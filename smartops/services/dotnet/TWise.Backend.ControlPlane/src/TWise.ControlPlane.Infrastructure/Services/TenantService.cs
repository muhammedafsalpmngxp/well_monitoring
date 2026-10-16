using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class TenantService(
    IGenericRepository<Region> regionRepo,
    IGenericRepository<SchemaVersion> schemaVersionRepo,
    IGenericRepository<Tenant> tenantRepo) : ITenantService
{
    // ─── Region ──────────────────────────────────────────────────────────────

    public async Task<PagedResult<RegionDto>> ListRegionsAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await regionRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<RegionDto>(
            paged.Items.Select(e => new RegionDto(e.RegionId, e.RegionCode, e.RegionName, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<RegionDto?> GetRegionAsync(int id, CancellationToken ct)
    {
        var e = await regionRepo.GetAsync(id, ct);
        return e is null ? null : new RegionDto(e.RegionId, e.RegionCode, e.RegionName, e.IsActive);
    }

    public async Task<RegionDto> CreateRegionAsync(RegionCreateRequest request, CancellationToken ct)
    {
        var entity = new Region
        {
            RegionCode = request.RegionCode,
            RegionName = request.RegionName,
            IsActive = request.IsActive
        };
        var e = await regionRepo.AddAsync(entity, ct);
        return new RegionDto(e.RegionId, e.RegionCode, e.RegionName, e.IsActive);
    }

    public async Task<bool> UpdateRegionAsync(int id, RegionUpdateRequest request, CancellationToken ct)
    {
        var e = await regionRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.RegionCode = request.RegionCode;
        e.RegionName = request.RegionName;
        e.IsActive = request.IsActive;

        return await regionRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteRegionAsync(int id, CancellationToken ct)
    {
        return await regionRepo.DeleteAsync(id, ct);
    }

    // ─── SchemaVersion ───────────────────────────────────────────────────────

    public async Task<PagedResult<SchemaVersionDto>> ListSchemaVersionsAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await schemaVersionRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<SchemaVersionDto>(
            paged.Items.Select(e => new SchemaVersionDto(e.SchemaVersionId, e.VersionNo, e.Description, e.ReleasedAt, e.IsCurrent, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<SchemaVersionDto?> GetSchemaVersionAsync(int id, CancellationToken ct)
    {
        var e = await schemaVersionRepo.GetAsync(id, ct);
        return e is null ? null : new SchemaVersionDto(e.SchemaVersionId, e.VersionNo, e.Description, e.ReleasedAt, e.IsCurrent, e.IsActive);
    }

    public async Task<SchemaVersionDto> CreateSchemaVersionAsync(SchemaVersionCreateRequest request, CancellationToken ct)
    {
        var entity = new SchemaVersion
        {
            VersionNo = request.VersionNo,
            Description = request.Description,
            ReleasedAt = request.ReleasedAt,
            IsCurrent = request.IsCurrent,
            IsActive = request.IsActive
        };
        var e = await schemaVersionRepo.AddAsync(entity, ct);
        return new SchemaVersionDto(e.SchemaVersionId, e.VersionNo, e.Description, e.ReleasedAt, e.IsCurrent, e.IsActive);
    }

    public async Task<bool> UpdateSchemaVersionAsync(int id, SchemaVersionUpdateRequest request, CancellationToken ct)
    {
        var e = await schemaVersionRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.VersionNo = request.VersionNo;
        e.Description = request.Description;
        e.ReleasedAt = request.ReleasedAt;
        e.IsCurrent = request.IsCurrent;
        e.IsActive = request.IsActive;

        return await schemaVersionRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteSchemaVersionAsync(int id, CancellationToken ct)
    {
        return await schemaVersionRepo.DeleteAsync(id, ct);
    }

    // ─── Tenant ──────────────────────────────────────────────────────────────

    public async Task<PagedResult<TenantDto>> ListTenantsAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await tenantRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<TenantDto>(
            paged.Items.Select(e => new TenantDto(e.TenantId, e.TenantCode, e.TenantName, e.RegionId, e.IsolationMode, e.DataPlaneRef, e.SchemaVersionId, e.Status, e.ProvisionStep, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<TenantDto?> GetTenantAsync(long id, CancellationToken ct)
    {
        var e = await tenantRepo.GetAsync(id, ct);
        return e is null ? null : new TenantDto(e.TenantId, e.TenantCode, e.TenantName, e.RegionId, e.IsolationMode, e.DataPlaneRef, e.SchemaVersionId, e.Status, e.ProvisionStep, e.IsActive);
    }

    public async Task<TenantDto> CreateTenantAsync(TenantCreateRequest request, CancellationToken ct)
    {
        var entity = new Tenant
        {
            TenantCode = request.TenantCode,
            TenantName = request.TenantName,
            RegionId = request.RegionId,
            IsolationMode = request.IsolationMode,
            DataPlaneRef = request.DataPlaneRef,
            SchemaVersionId = request.SchemaVersionId,
            Status = "pending_provision",
            ProvisionStep = null,
            IsActive = request.IsActive
        };
        var e = await tenantRepo.AddAsync(entity, ct);
        return new TenantDto(e.TenantId, e.TenantCode, e.TenantName, e.RegionId, e.IsolationMode, e.DataPlaneRef, e.SchemaVersionId, e.Status, e.ProvisionStep, e.IsActive);
    }

    public async Task<bool> UpdateTenantAsync(long id, TenantUpdateRequest request, CancellationToken ct)
    {
        var e = await tenantRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantCode = request.TenantCode;
        e.TenantName = request.TenantName;
        e.RegionId = request.RegionId;
        e.IsolationMode = request.IsolationMode;
        e.DataPlaneRef = request.DataPlaneRef;
        e.SchemaVersionId = request.SchemaVersionId;
        e.Status = request.Status;
        e.IsActive = request.IsActive;

        return await tenantRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteTenantAsync(long id, CancellationToken ct)
    {
        return await tenantRepo.DeleteAsync(id, ct);
    }
}
