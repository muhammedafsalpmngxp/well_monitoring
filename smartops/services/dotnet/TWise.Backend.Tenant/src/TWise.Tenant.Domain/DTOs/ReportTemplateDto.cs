namespace TWise.Tenant.Domain.DTOs;

/// <summary>Sent by the frontend to save/update the design template for a data source.</summary>
public record SaveReportTemplateRequest(
    string CustomName,
    string SourceName,
    string SourceType,
    string TemplateJson,
    string Type,
    long? ViewId = null
);

/// <summary>Returned to the frontend — the saved design template for a data source.</summary>
public record ReportTemplateDto(
    long Id,
    string CustomName,
    string SourceName,
    string SourceType,
    string TemplateJson,
    string Type,
    bool IsActive,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    long? ViewId
);
