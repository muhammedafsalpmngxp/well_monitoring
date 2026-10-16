using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class SourceService(
    IGenericRepository<SourceSystem> sourceSystemRepo,
    IGenericRepository<TenantSource> tenantSourceRepo,
    IGenericRepository<CanonicalEntity> canonicalEntityRepo,
    IGenericRepository<CanonicalField> canonicalFieldRepo,
    IGenericRepository<FieldMapping> fieldMappingRepo,
    IGenericRepository<CapabilityProfile> capabilityProfileRepo) : ISourceService
{
    // ─── SourceSystem ────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<SourceSystemDto>> ListSourceSystemsAsync(CancellationToken ct)
    {
        var entities = await sourceSystemRepo.GetAllAsync(ct);
        return entities.Select(e => new SourceSystemDto(e.SourceSystemId, e.SourceCode, e.SourceName, e.SourceKind, e.IsActive)).ToList();
    }

    public async Task<SourceSystemDto?> GetSourceSystemAsync(int id, CancellationToken ct)
    {
        var e = await sourceSystemRepo.GetAsync(id, ct);
        return e is null ? null : new SourceSystemDto(e.SourceSystemId, e.SourceCode, e.SourceName, e.SourceKind, e.IsActive);
    }

    public async Task<SourceSystemDto> CreateSourceSystemAsync(SourceSystemCreateRequest request, CancellationToken ct)
    {
        var entity = new SourceSystem
        {
            SourceCode = request.SourceCode,
            SourceName = request.SourceName,
            SourceKind = request.SourceKind,
            IsActive = request.IsActive
        };
        var e = await sourceSystemRepo.AddAsync(entity, ct);
        return new SourceSystemDto(e.SourceSystemId, e.SourceCode, e.SourceName, e.SourceKind, e.IsActive);
    }

    public async Task<bool> UpdateSourceSystemAsync(int id, SourceSystemUpdateRequest request, CancellationToken ct)
    {
        var e = await sourceSystemRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.SourceCode = request.SourceCode;
        e.SourceName = request.SourceName;
        e.SourceKind = request.SourceKind;
        e.IsActive = request.IsActive;

        return await sourceSystemRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteSourceSystemAsync(int id, CancellationToken ct)
    {
        return await sourceSystemRepo.DeleteAsync(id, ct);
    }

    // ─── TenantSource ────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<TenantSourceDto>> ListTenantSourcesAsync(CancellationToken ct)
    {
        var entities = await tenantSourceRepo.GetAllAsync(ct);
        return entities.Select(e => new TenantSourceDto(e.TenantSourceId, e.TenantId, e.SourceSystemId, e.ConnectionRef, e.IngestionMode, e.IsSystemOfRecord, e.Status, e.IsActive)).ToList();
    }

    public async Task<TenantSourceDto?> GetTenantSourceAsync(long id, CancellationToken ct)
    {
        var e = await tenantSourceRepo.GetAsync(id, ct);
        return e is null ? null : new TenantSourceDto(e.TenantSourceId, e.TenantId, e.SourceSystemId, e.ConnectionRef, e.IngestionMode, e.IsSystemOfRecord, e.Status, e.IsActive);
    }

    public async Task<TenantSourceDto> CreateTenantSourceAsync(TenantSourceCreateRequest request, CancellationToken ct)
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
        var e = await tenantSourceRepo.AddAsync(entity, ct);
        return new TenantSourceDto(e.TenantSourceId, e.TenantId, e.SourceSystemId, e.ConnectionRef, e.IngestionMode, e.IsSystemOfRecord, e.Status, e.IsActive);
    }

    public async Task<bool> UpdateTenantSourceAsync(long id, TenantSourceUpdateRequest request, CancellationToken ct)
    {
        var e = await tenantSourceRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantId = request.TenantId;
        e.SourceSystemId = request.SourceSystemId;
        e.ConnectionRef = request.ConnectionRef;
        e.IngestionMode = request.IngestionMode;
        e.IsSystemOfRecord = request.IsSystemOfRecord;
        e.Status = request.Status;
        e.IsActive = request.IsActive;

        return await tenantSourceRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteTenantSourceAsync(long id, CancellationToken ct)
    {
        return await tenantSourceRepo.DeleteAsync(id, ct);
    }

    // ─── CanonicalEntity ─────────────────────────────────────────────────────

    public async Task<IReadOnlyList<CanonicalEntityDto>> ListCanonicalEntitiesAsync(CancellationToken ct)
    {
        var entities = await canonicalEntityRepo.GetAllAsync(ct);
        return entities.Select(e => new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive)).ToList();
    }

    public async Task<CanonicalEntityDto?> GetCanonicalEntityAsync(int id, CancellationToken ct)
    {
        var e = await canonicalEntityRepo.GetAsync(id, ct);
        return e is null ? null : new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive);
    }

    public async Task<CanonicalEntityDto> CreateCanonicalEntityAsync(CanonicalEntityCreateRequest request, CancellationToken ct)
    {
        var entity = new CanonicalEntity
        {
            EntityName = request.EntityName,
            SchemaVersionId = request.SchemaVersionId,
            Layer = request.Layer,
            Description = request.Description,
            IsActive = request.IsActive
        };
        var e = await canonicalEntityRepo.AddAsync(entity, ct);
        return new CanonicalEntityDto(e.CanonicalEntityId, e.EntityName, e.SchemaVersionId, e.Layer, e.Description, e.IsActive);
    }

    public async Task<bool> UpdateCanonicalEntityAsync(int id, CanonicalEntityUpdateRequest request, CancellationToken ct)
    {
        var e = await canonicalEntityRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.EntityName = request.EntityName;
        e.SchemaVersionId = request.SchemaVersionId;
        e.Layer = request.Layer;
        e.Description = request.Description;
        e.IsActive = request.IsActive;

        return await canonicalEntityRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteCanonicalEntityAsync(int id, CancellationToken ct)
    {
        return await canonicalEntityRepo.DeleteAsync(id, ct);
    }

    // ─── CanonicalField ──────────────────────────────────────────────────────

    public async Task<IReadOnlyList<CanonicalFieldDto>> ListCanonicalFieldsAsync(CancellationToken ct)
    {
        var entities = await canonicalFieldRepo.GetAllAsync(ct);
        return entities.Select(e => new CanonicalFieldDto(e.CanonicalFieldId, e.CanonicalEntityId, e.FieldName, e.DataType, e.IsRequired, e.IsUnique, e.ReferenceEntityId, e.Description, e.IsActive)).ToList();
    }

    public async Task<CanonicalFieldDto?> GetCanonicalFieldAsync(int id, CancellationToken ct)
    {
        var e = await canonicalFieldRepo.GetAsync(id, ct);
        return e is null ? null : new CanonicalFieldDto(e.CanonicalFieldId, e.CanonicalEntityId, e.FieldName, e.DataType, e.IsRequired, e.IsUnique, e.ReferenceEntityId, e.Description, e.IsActive);
    }

    public async Task<CanonicalFieldDto> CreateCanonicalFieldAsync(CanonicalFieldCreateRequest request, CancellationToken ct)
    {
        var entity = new CanonicalField
        {
            CanonicalEntityId = request.CanonicalEntityId,
            FieldName = request.FieldName,
            DataType = request.DataType,
            IsRequired = request.IsRequired,
            IsUnique = request.IsUnique,
            ReferenceEntityId = request.ReferenceEntityId,
            Description = request.Description,
            IsActive = request.IsActive
        };
        var e = await canonicalFieldRepo.AddAsync(entity, ct);
        return new CanonicalFieldDto(e.CanonicalFieldId, e.CanonicalEntityId, e.FieldName, e.DataType, e.IsRequired, e.IsUnique, e.ReferenceEntityId, e.Description, e.IsActive);
    }

    public async Task<bool> UpdateCanonicalFieldAsync(int id, CanonicalFieldUpdateRequest request, CancellationToken ct)
    {
        var e = await canonicalFieldRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.CanonicalEntityId = request.CanonicalEntityId;
        e.FieldName = request.FieldName;
        e.DataType = request.DataType;
        e.IsRequired = request.IsRequired;
        e.IsUnique = request.IsUnique;
        e.ReferenceEntityId = request.ReferenceEntityId;
        e.Description = request.Description;
        e.IsActive = request.IsActive;

        return await canonicalFieldRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteCanonicalFieldAsync(int id, CancellationToken ct)
    {
        return await canonicalFieldRepo.DeleteAsync(id, ct);
    }

    // ─── FieldMapping ────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<FieldMappingDto>> ListFieldMappingsAsync(CancellationToken ct)
    {
        var entities = await fieldMappingRepo.GetAllAsync(ct);
        return entities.Select(e => new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive)).ToList();
    }

    public async Task<FieldMappingDto?> GetFieldMappingAsync(long id, CancellationToken ct)
    {
        var e = await fieldMappingRepo.GetAsync(id, ct);
        return e is null ? null : new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive);
    }

    public async Task<FieldMappingDto> CreateFieldMappingAsync(FieldMappingCreateRequest request, CancellationToken ct)
    {
        var entity = new FieldMapping
        {
            TenantSourceId = request.TenantSourceId,
            CanonicalFieldId = request.CanonicalFieldId,
            SourceObject = request.SourceObject,
            SourceField = request.SourceField,
            TransformRule = request.TransformRule,
            IsActive = request.IsActive
        };
        var e = await fieldMappingRepo.AddAsync(entity, ct);
        return new FieldMappingDto(e.FieldMappingId, e.TenantSourceId, e.CanonicalFieldId, e.SourceObject, e.SourceField, e.TransformRule, e.IsActive);
    }

    public async Task<bool> UpdateFieldMappingAsync(long id, FieldMappingUpdateRequest request, CancellationToken ct)
    {
        var e = await fieldMappingRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantSourceId = request.TenantSourceId;
        e.CanonicalFieldId = request.CanonicalFieldId;
        e.SourceObject = request.SourceObject;
        e.SourceField = request.SourceField;
        e.TransformRule = request.TransformRule;
        e.IsActive = request.IsActive;

        return await fieldMappingRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteFieldMappingAsync(long id, CancellationToken ct)
    {
        return await fieldMappingRepo.DeleteAsync(id, ct);
    }

    // ─── CapabilityProfile ───────────────────────────────────────────────────

    public async Task<IReadOnlyList<CapabilityProfileDto>> ListCapabilityProfilesAsync(CancellationToken ct)
    {
        var entities = await capabilityProfileRepo.GetAllAsync(ct);
        return entities.Select(e => new CapabilityProfileDto(e.CapabilityId, e.TenantSourceId, e.CanonicalFieldId, e.IsAvailable, e.Note, e.IsActive)).ToList();
    }

    public async Task<CapabilityProfileDto?> GetCapabilityProfileAsync(long id, CancellationToken ct)
    {
        var e = await capabilityProfileRepo.GetAsync(id, ct);
        return e is null ? null : new CapabilityProfileDto(e.CapabilityId, e.TenantSourceId, e.CanonicalFieldId, e.IsAvailable, e.Note, e.IsActive);
    }

    public async Task<CapabilityProfileDto> CreateCapabilityProfileAsync(CapabilityProfileCreateRequest request, CancellationToken ct)
    {
        var entity = new CapabilityProfile
        {
            TenantSourceId = request.TenantSourceId,
            CanonicalFieldId = request.CanonicalFieldId,
            IsAvailable = request.IsAvailable,
            Note = request.Note,
            IsActive = request.IsActive
        };
        var e = await capabilityProfileRepo.AddAsync(entity, ct);
        return new CapabilityProfileDto(e.CapabilityId, e.TenantSourceId, e.CanonicalFieldId, e.IsAvailable, e.Note, e.IsActive);
    }

    public async Task<bool> UpdateCapabilityProfileAsync(long id, CapabilityProfileUpdateRequest request, CancellationToken ct)
    {
        var e = await capabilityProfileRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantSourceId = request.TenantSourceId;
        e.CanonicalFieldId = request.CanonicalFieldId;
        e.IsAvailable = request.IsAvailable;
        e.Note = request.Note;
        e.IsActive = request.IsActive;

        return await capabilityProfileRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteCapabilityProfileAsync(long id, CancellationToken ct)
    {
        return await capabilityProfileRepo.DeleteAsync(id, ct);
    }
}
