using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public sealed class DeleteWidgetLibraryHandler(IWidgetLibraryService svc)
    : IRequestHandler<DeleteWidgetLibraryCommand, bool>
{
    public Task<bool> Handle(DeleteWidgetLibraryCommand request, CancellationToken ct)
        => svc.DeleteAsync(request.Id, ct);
}
