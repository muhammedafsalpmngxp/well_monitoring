using MediatR;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public record DeleteWidgetLibraryCommand(int Id) : IRequest<bool>;
