using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public sealed class ListWidgetLibrariesHandler(IWidgetLibraryService svc)
    : IRequestHandler<ListWidgetLibrariesQuery, IReadOnlyList<WidgetLibraryDto>>
{
    public Task<IReadOnlyList<WidgetLibraryDto>> Handle(ListWidgetLibrariesQuery request, CancellationToken ct)
        => svc.ListAsync(request.Type, ct);
}

public sealed class GetWidgetLibraryHandler(IWidgetLibraryService svc)
    : IRequestHandler<GetWidgetLibraryQuery, WidgetLibraryDto?>
{
    public Task<WidgetLibraryDto?> Handle(GetWidgetLibraryQuery request, CancellationToken ct)
        => svc.GetAsync(request.Id, ct);
}
