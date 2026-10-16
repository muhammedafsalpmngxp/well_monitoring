using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reliability;

public record GetTableReliabilityQuery(string TableName) : IRequest<TableReliabilityDto>;