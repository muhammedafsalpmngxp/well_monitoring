using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ITenantService
{
    Task<PagedResult<RegionDto>> ListRegionsAsync(int page, int pageSize, CancellationToken ct);
    Task<RegionDto?> GetRegionAsync(int id, CancellationToken ct);
    Task<RegionDto> CreateRegionAsync(RegionCreateRequest request, CancellationToken ct);
    Task<bool> UpdateRegionAsync(int id, RegionUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteRegionAsync(int id, CancellationToken ct);

    Task<PagedResult<SchemaVersionDto>> ListSchemaVersionsAsync(int page, int pageSize, CancellationToken ct);
    Task<SchemaVersionDto?> GetSchemaVersionAsync(int id, CancellationToken ct);
    Task<SchemaVersionDto> CreateSchemaVersionAsync(SchemaVersionCreateRequest request, CancellationToken ct);
    Task<bool> UpdateSchemaVersionAsync(int id, SchemaVersionUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteSchemaVersionAsync(int id, CancellationToken ct);

    Task<PagedResult<TenantDto>> ListTenantsAsync(int page, int pageSize, CancellationToken ct);
    Task<TenantDto?> GetTenantAsync(long id, CancellationToken ct);
    Task<TenantDto> CreateTenantAsync(TenantCreateRequest request, CancellationToken ct);
    Task<bool> UpdateTenantAsync(long id, TenantUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteTenantAsync(long id, CancellationToken ct);
}
