using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reliability;

public sealed class GetTableReliabilityHandler(IReliabilityRepository repository)
    : IRequestHandler<GetTableReliabilityQuery, TableReliabilityDto>
{
    public Task<TableReliabilityDto> Handle(GetTableReliabilityQuery request, CancellationToken cancellationToken)
        => repository.GetTableReliabilityAsync(request.TableName, cancellationToken);
}