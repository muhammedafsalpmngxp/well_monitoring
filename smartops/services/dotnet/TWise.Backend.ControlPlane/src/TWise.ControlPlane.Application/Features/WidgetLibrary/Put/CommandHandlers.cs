using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public sealed class UpdateWidgetLibraryHandler(IWidgetLibraryService svc)
    : IRequestHandler<UpdateWidgetLibraryCommand, bool>
{
    public Task<bool> Handle(UpdateWidgetLibraryCommand request, CancellationToken ct)
        => svc.UpdateAsync(request.Id, request.Request, request.UserId, ct);
}
