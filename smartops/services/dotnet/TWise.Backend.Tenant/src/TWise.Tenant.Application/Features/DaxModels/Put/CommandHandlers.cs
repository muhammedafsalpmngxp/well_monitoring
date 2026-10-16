using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class UpdateDaxModelHandler(IDaxModelRepository repo) : IRequestHandler<UpdateDaxModelCommand, DaxModelDto?>
{
    public async Task<DaxModelDto?> Handle(UpdateDaxModelCommand c, CancellationToken ct)
    {
        var model = await repo.GetByIdAsync(c.Id, c.IsAdmin ? null : c.UserId, ct);
        if (model is null) return null;
        DaxModelMapping.Apply(model, c.Request);
        await repo.UpdateAsync(model, ct);
        var usage = await repo.CountChartUsageAsync([model.Id], ct);
        return DaxModelMapping.ToDto(model, usage.GetValueOrDefault(model.Id));
    }
}
