using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.DaxModels;

public sealed class CreateDaxModelHandler(IDaxModelRepository repo) : IRequestHandler<CreateDaxModelCommand, DaxModelDto>
{
    public async Task<DaxModelDto> Handle(CreateDaxModelCommand c, CancellationToken ct)
    {
        var model = new SavedDaxModel { CreatedBy = c.UserId };
        DaxModelMapping.Apply(model, c.Request);
        var saved = await repo.AddAsync(model, ct);
        return DaxModelMapping.ToDto(saved, usedInCharts: 0);
    }
}
