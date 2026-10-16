namespace TWise.Tenant.Domain.DTOs;

public record ValidationRuleDto(
    string RuleId, string Category, string RuleName, string Table, string Severity,
    string ActiveYn, string Query, int? MaxRecords, string? StartDate, string? EndDate,
    string? PrimaryField, string? TriggeredOn, string? Fields, string? RuleDesc, string? SourceType, long? ViewId);

public record ErrorLogDto(
    string ErrorId, string RuleId, string? Severity, string? RuleName, string? PrimaryField,
    string Status, string? Well, string? Sla, string? CreatedAt, string? ChangedBy,
    string? Category, string? Fields, string? RuleDesc,
    string? TableName, int? MaxRecords, int? RecordsFound);

public record ReliabilityRuleDto(
    string RuleId, string RuleName, string? RuleDesc, string? Category, string? Severity,
    int? RecordsFound, int? RecordsTotal, string RecordsPerExecution, decimal? Reliability, string? TriggeredOn,
    bool Contributes);

public record ReliabilityDetailResponse(
    string Source, decimal? Reliability, string ReliabilityBreakdown, List<ReliabilityRuleDto> Rules);

public record CreateValidationRuleResponse(string RuleId, string Message, string ActiveYn);
public record UpdateRuleResponse(string RuleId, string Message);
public record ToggleActiveResponse(string RuleId, string ActiveYn, string Message);
public record ExecuteRuleResponse(string RuleId, string Message, int Inserted, int Total);
public record DeleteRuleResponse(string RuleId, string Message);
public record ErrorActionResponse(string ErrorId, string Action, string? ChangedBy, string Message);
public record ErrorStatusResponse(string ErrorId, string Status, string? ChangedBy, string Message);
public record ListRulesResponse(List<ValidationRuleDto> Rules);
public record ListErrorsResponse(List<ErrorLogDto> Errors);
