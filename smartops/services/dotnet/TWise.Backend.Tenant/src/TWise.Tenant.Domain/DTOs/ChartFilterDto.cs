namespace TWise.Tenant.Domain.DTOs;

public record ChartFilterParam(
    string SourceTable,
    string SourceColumn,
    string ControlType,
    string Value,
    string? Label = null,
    IReadOnlyList<string>? Values = null,
    bool DashboardAdditional = false,
    // Best-effort filter (e.g. a global cluster/plant on a Table source): if the source table has no
    // FK path to the filter table, the filter is skipped (data returned unfiltered) instead of failing.
    bool Optional = false,
    string? AdvancedHierarchy = null
);

public record ChartFilteredDataRequest(
    string ChartSource,
    string ChartSourceType,
    long? ViewId,
    IReadOnlyList<ChartFilterParam> Filters,
    string? FromDate = null,
    string? ToDate = null,
    string? Mode = null,
    // Report-level conditions with operators, AND/OR and relative dates. Applied in addition
    // to Filters, which stays for callers that only need equality.
    IReadOnlyList<ReportFilter>? ReportFilters = null,
    // Keeps only the highest or lowest N rows after filtering.
    TopNSpec? TopN = null,
    string? Aggregation = null,
    string? ValueField = null,
    bool PreserveFutureDateRange = false,
    TileDaxRequestDto? Dax = null
);
