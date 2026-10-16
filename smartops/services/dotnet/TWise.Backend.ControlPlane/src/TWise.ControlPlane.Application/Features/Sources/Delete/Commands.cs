using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public record DeleteSourceSystemCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["source-systems:*"];
}
public record DeleteTenantSourceCommand(long Id) : IRequest<Result>;
public record DeleteCanonicalEntityCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-entities:*"];
}
public record DeleteCanonicalFieldCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["canonical-fields:*"];
}
public record DeleteFieldMappingCommand(long Id) : IRequest<Result>;
public record DeleteCapabilityProfileCommand(long Id) : IRequest<Result>;
