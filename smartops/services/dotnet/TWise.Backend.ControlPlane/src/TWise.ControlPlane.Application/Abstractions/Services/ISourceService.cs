using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ISourceService
{
    Task<IReadOnlyList<SourceSystemDto>> ListSourceSystemsAsync(CancellationToken ct);
    Task<SourceSystemDto?> GetSourceSystemAsync(int id, CancellationToken ct);
    Task<SourceSystemDto> CreateSourceSystemAsync(SourceSystemCreateRequest request, CancellationToken ct);
    Task<bool> UpdateSourceSystemAsync(int id, SourceSystemUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteSourceSystemAsync(int id, CancellationToken ct);

    Task<IReadOnlyList<TenantSourceDto>> ListTenantSourcesAsync(CancellationToken ct);
    Task<TenantSourceDto?> GetTenantSourceAsync(long id, CancellationToken ct);
    Task<TenantSourceDto> CreateTenantSourceAsync(TenantSourceCreateRequest request, CancellationToken ct);
    Task<bool> UpdateTenantSourceAsync(long id, TenantSourceUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteTenantSourceAsync(long id, CancellationToken ct);

    Task<IReadOnlyList<CanonicalEntityDto>> ListCanonicalEntitiesAsync(CancellationToken ct);
    Task<CanonicalEntityDto?> GetCanonicalEntityAsync(int id, CancellationToken ct);
    Task<CanonicalEntityDto> CreateCanonicalEntityAsync(CanonicalEntityCreateRequest request, CancellationToken ct);
    Task<bool> UpdateCanonicalEntityAsync(int id, CanonicalEntityUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteCanonicalEntityAsync(int id, CancellationToken ct);

    Task<IReadOnlyList<CanonicalFieldDto>> ListCanonicalFieldsAsync(CancellationToken ct);
    Task<CanonicalFieldDto?> GetCanonicalFieldAsync(int id, CancellationToken ct);
    Task<CanonicalFieldDto> CreateCanonicalFieldAsync(CanonicalFieldCreateRequest request, CancellationToken ct);
    Task<bool> UpdateCanonicalFieldAsync(int id, CanonicalFieldUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteCanonicalFieldAsync(int id, CancellationToken ct);

    Task<IReadOnlyList<FieldMappingDto>> ListFieldMappingsAsync(CancellationToken ct);
    Task<FieldMappingDto?> GetFieldMappingAsync(long id, CancellationToken ct);
    Task<FieldMappingDto> CreateFieldMappingAsync(FieldMappingCreateRequest request, CancellationToken ct);
    Task<bool> UpdateFieldMappingAsync(long id, FieldMappingUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteFieldMappingAsync(long id, CancellationToken ct);

    Task<IReadOnlyList<CapabilityProfileDto>> ListCapabilityProfilesAsync(CancellationToken ct);
    Task<CapabilityProfileDto?> GetCapabilityProfileAsync(long id, CancellationToken ct);
    Task<CapabilityProfileDto> CreateCapabilityProfileAsync(CapabilityProfileCreateRequest request, CancellationToken ct);
    Task<bool> UpdateCapabilityProfileAsync(long id, CapabilityProfileUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteCapabilityProfileAsync(long id, CancellationToken ct);
}
