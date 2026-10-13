using MediatR;
using TWise.Tenant.Application.Abstractions;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class DeleteDaxModelHandler(IDaxModelRepository repo) : IRequestHandler<DeleteDaxModelCommand, DeleteDaxModelResult>
{
    public async Task<DeleteDaxModelResult> Handle(DeleteDaxModelCommand c, CancellationToken ct)
    {
        var model = await repo.GetByIdAsync(c.Id, c.IsAdmin ? null : c.UserId, ct);
        if (model is null) return new(DeleteDaxModelStatus.NotFound);
        // Charts keep a link to the model (savedModelId), so a model in use is kept.
        var charts = await repo.ListChartNamesUsingAsync(model.Id, ct);
        if (charts.Count > 0) return new(DeleteDaxModelStatus.InUse, model.Name, charts);
        model.IsDeleted = true;
        await repo.UpdateAsync(model, ct);
        return new(DeleteDaxModelStatus.Deleted, model.Name);
    }
}
