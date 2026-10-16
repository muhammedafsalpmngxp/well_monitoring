using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public record ToggleRuleActiveCommand(string RuleId, string ActiveYn) : IRequest<Result<ToggleActiveResponse>>;
public record UpdateErrorActionCommand(string ErrorId, string Action, string? ChangedBy) : IRequest<Result<ErrorActionResponse>>;
public record UpdateErrorStatusCommand(string ErrorId, string Status, string? ChangedBy) : IRequest<Result<ErrorStatusResponse>>;
