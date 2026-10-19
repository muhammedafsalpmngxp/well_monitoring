using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

/// <summary>Saves what Ask Data may read and its limits; the allowed schemas are checked against the Ask Data database.</summary>
public sealed record SaveAskDataSettingsCommand(long TenantId, string UserId, SaveAskDataSettingsRequest Request) : IRequest<AskDataSettingsDto>;
