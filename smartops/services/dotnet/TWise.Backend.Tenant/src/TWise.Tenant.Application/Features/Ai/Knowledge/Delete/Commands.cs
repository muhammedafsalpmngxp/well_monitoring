using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed record DeleteAiExampleCommand(long TenantId, long Id) : IRequest<bool>;
