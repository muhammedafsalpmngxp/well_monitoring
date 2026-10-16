namespace SmartOps.Dashboard.Domain.Dtos;

public record ActivitiesProgressDto(
    double Progress,
    int Completed,
    int InProgress,
    int NotStarted,
    int Total
);

public record ActivitiesProgressResponse(
    ActivitiesProgressDto Data,
    ActivitiesProgressFilters Filters
);

public record ActivitiesProgressFilters(
    string Odc,
    string? Cluster,
    string? ProjectId,
    string? ScheduleId,
    string? WellId,
    DateTime? StartDate,
    DateTime? EndDate
);

public record ActivityRowDto(
    string Code,
    string Description,
    string WellId,
    string Cluster,
    string Status,
    double ProgressPct,
    string? StartDate,
    string? EndDate,
    string? Assignee
);

public record ActivitiesListResponseDto(
    ActivitiesProgressDto Summary,
    IReadOnlyList<ActivityRowDto> Items,
    int Page,
    int PageSize,
    int TotalRows,
    int TotalPages
);
