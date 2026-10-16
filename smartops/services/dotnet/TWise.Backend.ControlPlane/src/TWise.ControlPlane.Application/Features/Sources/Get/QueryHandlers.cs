using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public sealed class ListSourceSystemsHandler(ISourceSystemService svc) : IRequestHandler<ListSourceSystemsQuery, Result<PagedResult<SourceSystemDto>>>
{
    public async Task<Result<PagedResult<SourceSystemDto>>> Handle(ListSourceSystemsQuery request, CancellationToken ct)
        => Result<PagedResult<SourceSystemDto>>.Success(await svc.ListAsync(request.Page, request.PageSize, ct));
}

public sealed class GetSourceSystemHandler(ISourceSystemService svc) : IRequestHandler<GetSourceSystemQuery, Result<SourceSystemDto>>
{
    public async Task<Result<SourceSystemDto>> Handle(GetSourceSystemQuery request, CancellationToken ct)
    {
        var dto = await svc.GetAsync(request.Id, ct);
        return dto is null ? Result<SourceSystemDto>.NotFound() : Result<SourceSystemDto>.Success(dto);
    }
}

public sealed class ListTenantSourcesHandler(ITenantSourceService svc) : IRequestHandler<ListTenantSourcesQuery, Result<PagedResult<TenantSourceDto>>>
{
    public async Task<Result<PagedResult<TenantSourceDto>>> Handle(ListTenantSourcesQuery request, CancellationToken ct)
        => Result<PagedResult<TenantSourceDto>>.Success(await svc.ListAsync(request.Page, request.PageSize, ct));
}

public sealed class GetTenantSourceHandler(ITenantSourceService svc) : IRequestHandler<GetTenantSourceQuery, Result<TenantSourceDto>>
{
    public async Task<Result<TenantSourceDto>> Handle(GetTenantSourceQuery request, CancellationToken ct)
    {
        var dto = await svc.GetAsync(request.Id, ct);
        return dto is null ? Result<TenantSourceDto>.NotFound() : Result<TenantSourceDto>.Success(dto);
    }
}

public sealed class ListCanonicalEntitiesHandler(ICanonicalEntityService svc) : IRequestHandler<ListCanonicalEntitiesQuery, Result<PagedResult<CanonicalEntityDto>>>
{
    public async Task<Result<PagedResult<CanonicalEntityDto>>> Handle(ListCanonicalEntitiesQuery request, CancellationToken ct)
        => Result<PagedResult<CanonicalEntityDto>>.Success(await svc.ListAsync(request.Page, request.PageSize, ct));
}

public sealed class GetCanonicalEntityHandler(ICanonicalEntityService svc) : IRequestHandler<GetCanonicalEntityQuery, Result<CanonicalEntityDto>>
{
    public async Task<Result<CanonicalEntityDto>> Handle(GetCanonicalEntityQuery request, CancellationToken ct)
    {
        var dto = await svc.GetAsync(request.Id, ct);
        return dto is null ? Result<CanonicalEntityDto>.NotFound() : Result<CanonicalEntityDto>.Success(dto);
    }
}

public sealed class ListCanonicalFieldsHandler(ICanonicalFieldService svc) : IRequestHandler<ListCanonicalFieldsQuery, Result<PagedResult<CanonicalFieldDto>>>
{
    public async Task<Result<PagedResult<CanonicalFieldDto>>> Handle(ListCanonicalFieldsQuery request, CancellationToken ct)
        => Result<PagedResult<CanonicalFieldDto>>.Success(await svc.ListAsync(request.Page, request.PageSize, ct));
}

public sealed class GetCanonicalFieldHandler(ICanonicalFieldService svc) : IRequestHandler<GetCanonicalFieldQuery, Result<CanonicalFieldDto>>
{
    public async Task<Result<CanonicalFieldDto>> Handle(GetCanonicalFieldQuery request, CancellationToken ct)
    {
        var dto = await svc.GetAsync(request.Id, ct);
        return dto is null ? Result<CanonicalFieldDto>.NotFound() : Result<CanonicalFieldDto>.Success(dto);
    }
}

public sealed class ListFieldMappingsHandler(IFieldMappingService svc) : IRequestHandler<ListFieldMappingsQuery, Result<PagedResult<FieldMappingDto>>>
{
    public async Task<Result<PagedResult<FieldMappingDto>>> Handle(ListFieldMappingsQuery request, CancellationToken ct)
        => Result<PagedResult<FieldMappingDto>>.Success(await svc.ListAsync(request.Page, request.PageSize, ct));
}

public sealed class GetFieldMappingHandler(IFieldMappingService svc) : IRequestHandler<GetFieldMappingQuery, Result<FieldMappingDto>>
{
    public async Task<Result<FieldMappingDto>> Handle(GetFieldMappingQuery request, CancellationToken ct)
    {
        var dto = await svc.GetAsync(request.Id, ct);
        return dto is null ? Result<FieldMappingDto>.NotFound() : Result<FieldMappingDto>.Success(dto);
    }
}

public sealed class ListCapabilityProfilesHandler(ICapabilityProfileService svc) : IRequestHandler<ListCapabilityProfilesQuery, Result<PagedResult<CapabilityProfileDto>>>
{
    public async Task<Result<PagedResult<CapabilityProfileDto>>> Handle(ListCapabilityProfilesQuery request, CancellationToken ct)
        => Result<PagedResult<CapabilityProfileDto>>.Success(await svc.ListAsync(request.Page, request.PageSize, ct));
}

public sealed class GetCapabilityProfileHandler(ISourceService svc) : IRequestHandler<GetCapabilityProfileQuery, Result<CapabilityProfileDto>>
{
    public async Task<Result<CapabilityProfileDto>> Handle(GetCapabilityProfileQuery request, CancellationToken ct)
    {
        var dto = await svc.GetCapabilityProfileAsync(request.Id, ct);
        return dto is null ? Result<CapabilityProfileDto>.NotFound() : Result<CapabilityProfileDto>.Success(dto);
    }
}
