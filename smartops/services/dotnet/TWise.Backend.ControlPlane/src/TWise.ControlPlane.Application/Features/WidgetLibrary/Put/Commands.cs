using MediatR;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public record UpdateWidgetLibraryCommand(int Id, UpdateWidgetLibraryRequest Request, long UserId) : IRequest<bool>;
