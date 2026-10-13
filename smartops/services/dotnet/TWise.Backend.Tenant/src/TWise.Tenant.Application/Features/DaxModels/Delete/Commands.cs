using MediatR;

namespace TWise.Tenant.Application.Features.DaxModels;

public enum DeleteDaxModelStatus { Deleted, NotFound, InUse }

/// <param name="UsedInCharts">Charts that use the model; set when Status is InUse.</param>
public sealed record DeleteDaxModelResult(DeleteDaxModelStatus Status, string? Name = null, int UsedInCharts = 0);

/// <summary>Soft-deletes a model. NotFound when no model has that id, or it belongs to another user and the
/// caller is not an admin; InUse when a saved chart still uses it.</summary>
public sealed record DeleteDaxModelCommand(long Id, long UserId, bool IsAdmin) : IRequest<DeleteDaxModelResult>;
