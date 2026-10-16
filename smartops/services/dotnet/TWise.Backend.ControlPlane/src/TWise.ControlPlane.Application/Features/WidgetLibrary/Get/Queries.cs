using MediatR;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;

public record ListWidgetLibrariesQuery(string? Type) : IRequest<IReadOnlyList<WidgetLibraryDto>>;
public record GetWidgetLibraryQuery(int Id) : IRequest<WidgetLibraryDto?>;
