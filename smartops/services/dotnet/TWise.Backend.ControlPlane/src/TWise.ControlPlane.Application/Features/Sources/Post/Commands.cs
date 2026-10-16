using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public record CreateSourceSystemCommand(SourceSystemCreateRequest Request) : IRequest<Result<SourceSystemDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["source-systems:*"];
}
public record CreateTenantSourceCommand(TenantSourceCreateRequest Request) : IRequest<Result<TenantSourceDto>>;
public record CreateCanonicalEntityCommand(CanonicalEntityCreateRequest Request) : IRequest<Result<CanonicalEntityDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-entities:*"];
}
public record CreateCanonicalFieldCommand(CanonicalFieldCreateRequest Request) : IRequest<Result<CanonicalFieldDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-fields:*"];
}
public record CreateFieldMappingCommand(FieldMappingCreateRequest Request) : IRequest<Result<FieldMappingDto>>;
public record CreateCapabilityProfileCommand(CapabilityProfileCreateRequest Request) : IRequest<Result<CapabilityProfileDto>>;

// Bulk create commands
public record BulkCreateCanonicalEntitiesCommand(BulkCanonicalEntityCreateRequest Request) : IRequest<Result<IReadOnlyList<CanonicalEntityDto>>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-entities:*"];
}
public record BulkCreateCanonicalFieldsCommand(BulkCanonicalFieldCreateRequest Request) : IRequest<Result<IReadOnlyList<CanonicalFieldDto>>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-fields:*"];
}
public record BulkCreateFieldMappingsCommand(BulkFieldMappingCreateRequest Request) : IRequest<Result<IReadOnlyList<FieldMappingDto>>>;
