using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public sealed class CreateSourceSystemHandler(ISourceSystemService svc) : IRequestHandler<CreateSourceSystemCommand, Result<SourceSystemDto>>
{
    public async Task<Result<SourceSystemDto>> Handle(CreateSourceSystemCommand cmd, CancellationToken ct)
        => Result<SourceSystemDto>.Success(await svc.CreateAsync(cmd.Request, ct));
}

public sealed class CreateTenantSourceHandler(ITenantSourceService svc) : IRequestHandler<CreateTenantSourceCommand, Result<TenantSourceDto>>
{
    public async Task<Result<TenantSourceDto>> Handle(CreateTenantSourceCommand cmd, CancellationToken ct)
        => Result<TenantSourceDto>.Success(await svc.CreateAsync(cmd.Request, ct));
}

public sealed class CreateCanonicalEntityHandler(ICanonicalEntityService svc) : IRequestHandler<CreateCanonicalEntityCommand, Result<CanonicalEntityDto>>
{
    public async Task<Result<CanonicalEntityDto>> Handle(CreateCanonicalEntityCommand cmd, CancellationToken ct)
        => Result<CanonicalEntityDto>.Success(await svc.CreateAsync(cmd.Request, ct));
}

public sealed class CreateCanonicalFieldHandler(ICanonicalFieldService svc) : IRequestHandler<CreateCanonicalFieldCommand, Result<CanonicalFieldDto>>
{
    public async Task<Result<CanonicalFieldDto>> Handle(CreateCanonicalFieldCommand cmd, CancellationToken ct)
        => Result<CanonicalFieldDto>.Success(await svc.CreateAsync(cmd.Request, ct));
}

public sealed class CreateFieldMappingHandler(IFieldMappingService svc) : IRequestHandler<CreateFieldMappingCommand, Result<FieldMappingDto>>
{
    public async Task<Result<FieldMappingDto>> Handle(CreateFieldMappingCommand cmd, CancellationToken ct)
        => Result<FieldMappingDto>.Success(await svc.CreateAsync(cmd.Request, ct));
}

public sealed class CreateCapabilityProfileHandler(ICapabilityProfileService svc) : IRequestHandler<CreateCapabilityProfileCommand, Result<CapabilityProfileDto>>
{
    public async Task<Result<CapabilityProfileDto>> Handle(CreateCapabilityProfileCommand cmd, CancellationToken ct)
        => Result<CapabilityProfileDto>.Success(await svc.CreateAsync(cmd.Request, ct));
}

// Bulk create handlers
public sealed class BulkCreateCanonicalEntitiesHandler(ICanonicalEntityService svc) : IRequestHandler<BulkCreateCanonicalEntitiesCommand, Result<IReadOnlyList<CanonicalEntityDto>>>
{
    public async Task<Result<IReadOnlyList<CanonicalEntityDto>>> Handle(BulkCreateCanonicalEntitiesCommand cmd, CancellationToken ct)
        => Result<IReadOnlyList<CanonicalEntityDto>>.Success(await svc.BulkCreateAsync(cmd.Request.Items, ct));
}

public sealed class BulkCreateCanonicalFieldsHandler(ICanonicalFieldService svc) : IRequestHandler<BulkCreateCanonicalFieldsCommand, Result<IReadOnlyList<CanonicalFieldDto>>>
{
    public async Task<Result<IReadOnlyList<CanonicalFieldDto>>> Handle(BulkCreateCanonicalFieldsCommand cmd, CancellationToken ct)
        => Result<IReadOnlyList<CanonicalFieldDto>>.Success(await svc.BulkCreateAsync(cmd.Request.Items, ct));
}

public sealed class BulkCreateFieldMappingsHandler(IFieldMappingService svc) : IRequestHandler<BulkCreateFieldMappingsCommand, Result<IReadOnlyList<FieldMappingDto>>>
{
    public async Task<Result<IReadOnlyList<FieldMappingDto>>> Handle(BulkCreateFieldMappingsCommand cmd, CancellationToken ct)
        => Result<IReadOnlyList<FieldMappingDto>>.Success(await svc.BulkCreateAsync(cmd.Request.Items, ct));
}
