using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataViews;

/// <summary>Saves an Ask Data answer as a data source for the Chart Builder and dashboards (Chart AI feature).</summary>
public sealed record SaveAskDataViewCommand(long TenantId, long UserId, long MessageId) : IRequest<AskDataViewDto?>;
