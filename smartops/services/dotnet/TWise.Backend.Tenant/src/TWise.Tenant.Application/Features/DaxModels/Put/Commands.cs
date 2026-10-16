using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DaxModels;

/// <summary>Returns null when no model has that id, or it belongs to another user and the caller is not an admin.</summary>
public sealed record UpdateDaxModelCommand(long Id, DaxModelSaveRequest Request, long UserId, bool IsAdmin) : IRequest<DaxModelDto?>;
