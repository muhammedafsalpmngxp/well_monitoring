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
        var charts = await repo.ListChartsUsingAsync(model.Id, ct);
        if (charts.Count > 0)
        {
            // Only charts the caller may open are named (as the widget list: own or published; admins all).
            var visible = charts.Where(ch => c.IsAdmin || ch.CreatedBy == c.UserId || ch.Published).Select(ch => ch.Name).ToList();
            return new(DeleteDaxModelStatus.InUse, model.Name, visible, charts.Count - visible.Count);
        }
        model.IsDeleted = true;
        await repo.UpdateAsync(model, ct);
        return new(DeleteDaxModelStatus.Deleted, model.Name);
    }
}
