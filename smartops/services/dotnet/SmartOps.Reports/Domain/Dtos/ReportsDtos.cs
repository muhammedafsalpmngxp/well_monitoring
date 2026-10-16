using System.ComponentModel.DataAnnotations;

namespace SmartOps.Reports.Domain.Dtos;

public record ReportDto(int Id, string Key, string Name, string Category,
                        string? Description, object Layout, DateTime CreatedAt);

public record ReportCreateRequest(
    [Required] string Key, [Required] string Name, [Required] string Category,
    string? Description, object Layout);

public record ScheduleDto(int Id, string ReportKey, string Cron,
                          IReadOnlyList<string> Recipients, string Format,
                          DateTime? LastRun, DateTime? NextRun, string Status);

public record ScheduleCreateRequest(
    [Required] string ReportKey, [Required] string Cron,
    IReadOnlyList<string> Recipients, string Format = "pdf");

public record BriefingDto(int Id, string Audience, string Period, string Headline,
                          object Body, DateTime CreatedAt);

public record AlertDto(int Id, string Category, string Severity, string Title,
                       string? Detail, string? WellId, object Payload,
                       DateTime CreatedAt, bool Acknowledged);

public record AlertCreateRequest(
    [Required] string Category, [Required] string Severity, [Required] string Title,
    string? Detail, string? WellId, object Payload);
