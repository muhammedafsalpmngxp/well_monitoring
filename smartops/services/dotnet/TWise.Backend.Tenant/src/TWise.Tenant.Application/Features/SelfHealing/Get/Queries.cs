using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.SelfHealing;

/// <summary>The Self-Healing scan of the last Days days (null: the first of SelfHealing:Days).</summary>
public sealed record GetSelfHealingOverviewQuery(long TenantId, int? Days) : IRequest<SelfHealingOverviewDto>;
