namespace TWise.Tenant.Domain.DTOs;

/// <summary>Sent by the frontend when creating a new report. UserId and TenantId come from JWT.</summary>
public record CreateReportRequest(
    string ReportName,
    int CategoryId,
    string SourceName,
    string SourceType,
    string? ReportJson,
    string? Description = null
);

/// <summary>Sent by the frontend when updating an existing report.</summary>
public record UpdateReportRequest(
    string ReportName,
    int CategoryId,
    string SourceName,
    string SourceType,
    string? ReportJson,
    string Status,
    string? Description = null
);

/// <summary>Returned to the frontend for list and detail views.</summary>
public record ReportDto(
    long Id,
    string ReportName,
    string? Description,
    int CategoryId,
    string? CategoryName,
    string SourceName,
    string SourceType,
    string? ReportJson,
    string Status,
    DateTime? PublishedOn,
    long CreatedBy,
    long TenantId,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? CategoryDescription = null
);

// ── Version history ─────────────────────────────────────────────────────────

/// <summary>One published snapshot of a report, for the version-history list.</summary>
public record ReportVersionSummaryDto(
    int VersionNo,
    string ReportName,
    string? Description,
    string SourceName,
    string SourceType,
    string Reason,
    int? RestoredFromVersionNo,
    long PublishedBy,
    DateTime PublishedAt,
    bool IsCurrent
);

/// <summary>Result of restoring a report to an earlier published version.</summary>
public record RestoreReportVersionResponse(
    long ReportId,
    int RestoredFromVersionNo,
    int NewVersionNo,
    string Status,
    string Message
);
