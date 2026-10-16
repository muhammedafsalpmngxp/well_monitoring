using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public record UpdateValidationRuleCommand(
    string RuleId, string Category, string RuleName, string Table, string Severity,
    string Query, string? ValidationPeriod, int? MaxRecords,
    string? CustomStartDate, string? CustomEndDate,
    string? PrimaryField, string? Fields, string? RuleDesc,
    string? AdditionalCondition, string? SourceType, long? ViewId) : IRequest<Result<UpdateRuleResponse>>;
