using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public record DeleteValidationRuleCommand(string RuleId, long TenantId) : IRequest<Result<DeleteRuleResponse>>;
