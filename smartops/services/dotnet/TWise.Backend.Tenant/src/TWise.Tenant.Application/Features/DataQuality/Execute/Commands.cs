using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public record ExecuteValidationRuleCommand(string RuleId, long TenantId) : IRequest<Result<ExecuteRuleResponse>>;
