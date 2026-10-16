using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public sealed class UpdateSourceSystemHandler(ISourceSystemService svc) : IRequestHandler<UpdateSourceSystemCommand, Result>
{
    public async Task<Result> Handle(UpdateSourceSystemCommand cmd, CancellationToken ct) => await svc.UpdateAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateTenantSourceHandler(ITenantSourceService svc) : IRequestHandler<UpdateTenantSourceCommand, Result>
{
    public async Task<Result> Handle(UpdateTenantSourceCommand cmd, CancellationToken ct) => await svc.UpdateAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateCanonicalEntityHandler(ICanonicalEntityService svc) : IRequestHandler<UpdateCanonicalEntityCommand, Result>
{
    public async Task<Result> Handle(UpdateCanonicalEntityCommand cmd, CancellationToken ct) => await svc.UpdateAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateCanonicalFieldHandler(ICanonicalFieldService svc) : IRequestHandler<UpdateCanonicalFieldCommand, Result>
{
    public async Task<Result> Handle(UpdateCanonicalFieldCommand cmd, CancellationToken ct) => await svc.UpdateAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateFieldMappingHandler(IFieldMappingService svc) : IRequestHandler<UpdateFieldMappingCommand, Result>
{
    public async Task<Result> Handle(UpdateFieldMappingCommand cmd, CancellationToken ct) => await svc.UpdateAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateCapabilityProfileHandler(ICapabilityProfileService svc) : IRequestHandler<UpdateCapabilityProfileCommand, Result>
{
    public async Task<Result> Handle(UpdateCapabilityProfileCommand cmd, CancellationToken ct) => await svc.UpdateAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

// Bulk update handlers
public sealed class BulkUpdateCanonicalEntitiesHandler(ICanonicalEntityService svc) : IRequestHandler<BulkUpdateCanonicalEntitiesCommand, Result>
{
    public async Task<Result> Handle(BulkUpdateCanonicalEntitiesCommand cmd, CancellationToken ct) => await svc.BulkUpdateAsync(cmd.Request.Items, ct) ? Result.Success() : Result.NotFound();
}

public sealed class BulkUpdateCanonicalFieldsHandler(ICanonicalFieldService svc) : IRequestHandler<BulkUpdateCanonicalFieldsCommand, Result>
{
    public async Task<Result> Handle(BulkUpdateCanonicalFieldsCommand cmd, CancellationToken ct) => await svc.BulkUpdateAsync(cmd.Request.Items, ct) ? Result.Success() : Result.NotFound();
}

public sealed class BulkUpdateFieldMappingsHandler(IFieldMappingService svc) : IRequestHandler<BulkUpdateFieldMappingsCommand, Result>
{
    public async Task<Result> Handle(BulkUpdateFieldMappingsCommand cmd, CancellationToken ct) => await svc.BulkUpdateAsync(cmd.Request.Items, ct) ? Result.Success() : Result.NotFound();
}
