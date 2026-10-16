using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public record UpdateSourceSystemCommand(int Id, SourceSystemUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["source-systems:*"];
}
public record UpdateTenantSourceCommand(long Id, TenantSourceUpdateRequest Request) : IRequest<Result>;
public record UpdateCanonicalEntityCommand(int Id, CanonicalEntityUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-entities:*"];
}
public record UpdateCanonicalFieldCommand(int Id, CanonicalFieldUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-fields:*"];
}
public record UpdateFieldMappingCommand(long Id, FieldMappingUpdateRequest Request) : IRequest<Result>;
public record UpdateCapabilityProfileCommand(long Id, CapabilityProfileUpdateRequest Request) : IRequest<Result>;

// Bulk update commands
public record BulkUpdateCanonicalEntitiesCommand(BulkCanonicalEntityUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-entities:*"];
}
public record BulkUpdateCanonicalFieldsCommand(BulkCanonicalFieldUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-fields:*"];
}
public record BulkUpdateFieldMappingsCommand(BulkFieldMappingUpdateRequest Request) : IRequest<Result>;
