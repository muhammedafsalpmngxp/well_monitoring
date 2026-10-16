using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

/// <summary>Soft-deletes a provider; the active one cannot be deleted (InvalidOperationException).</summary>
public sealed record DeleteAiProviderCommand(long TenantId, string UserId, long Id) : IRequest<bool>;
