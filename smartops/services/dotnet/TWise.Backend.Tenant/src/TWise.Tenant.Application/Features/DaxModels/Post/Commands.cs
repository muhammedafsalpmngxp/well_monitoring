using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DaxModels;

/// <summary>The new model belongs to UserId.</summary>
public sealed record CreateDaxModelCommand(DaxModelSaveRequest Request, long UserId) : IRequest<DaxModelDto>;
