using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public sealed class CreateWidgetLibraryHandler(IWidgetLibraryService svc)
    : IRequestHandler<CreateWidgetLibraryCommand, WidgetLibraryDto>
{
    public Task<WidgetLibraryDto> Handle(CreateWidgetLibraryCommand request, CancellationToken ct)
        => svc.CreateAsync(request.Request, request.UserId, ct);
}
