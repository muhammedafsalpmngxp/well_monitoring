using MediatR;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public record CreateWidgetLibraryCommand(CreateWidgetLibraryRequest Request, long UserId) : IRequest<WidgetLibraryDto>;
