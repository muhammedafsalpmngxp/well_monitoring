using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public sealed class DeleteSourceSystemHandler(ISourceSystemService svc) : IRequestHandler<DeleteSourceSystemCommand, Result>
{
    public async Task<Result> Handle(DeleteSourceSystemCommand cmd, CancellationToken ct) => await svc.DeleteAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteTenantSourceHandler(ITenantSourceService svc) : IRequestHandler<DeleteTenantSourceCommand, Result>
{
    public async Task<Result> Handle(DeleteTenantSourceCommand cmd, CancellationToken ct) => await svc.DeleteAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteCanonicalEntityHandler(ICanonicalEntityService svc) : IRequestHandler<DeleteCanonicalEntityCommand, Result>
{
    public async Task<Result> Handle(DeleteCanonicalEntityCommand cmd, CancellationToken ct) => await svc.DeleteAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteCanonicalFieldHandler(ICanonicalFieldService svc) : IRequestHandler<DeleteCanonicalFieldCommand, Result>
{
    public async Task<Result> Handle(DeleteCanonicalFieldCommand cmd, CancellationToken ct) => await svc.DeleteAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteFieldMappingHandler(IFieldMappingService svc) : IRequestHandler<DeleteFieldMappingCommand, Result>
{
    public async Task<Result> Handle(DeleteFieldMappingCommand cmd, CancellationToken ct) => await svc.DeleteAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteCapabilityProfileHandler(ICapabilityProfileService svc) : IRequestHandler<DeleteCapabilityProfileCommand, Result>
{
    public async Task<Result> Handle(DeleteCapabilityProfileCommand cmd, CancellationToken ct) => await svc.DeleteAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}
