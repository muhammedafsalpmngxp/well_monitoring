using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

/// <summary>Create (Id null) or update a provider; the first one a tenant adds becomes active. KeyNotFoundException when Id is unknown.</summary>
public sealed record SaveAiProviderCommand(long TenantId, string UserId, long? Id, SaveAiProviderRequest Request) : IRequest<AiProviderDto?>;
public sealed record ActivateAiProviderCommand(long TenantId, string UserId, long Id) : IRequest<AiProviderDto?>;
/// <summary>Sends a one-line prompt to the provider (active or not).</summary>
public sealed record TestAiProviderCommand(long TenantId, string UserId, long Id) : IRequest<AiTestResultDto>;
