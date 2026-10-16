namespace TWise.Tenant.Contracts.DTOs;

public record FilterMetadataDto(
    int FilterId,
    string Placeholder,
    string DisplayName,
    string Category,
    string ControlType,
    string? DefaultValue,
    bool IsMandatory,
    int DisplayOrder,
    IReadOnlyList<object>? Values,
    string? DependsOn
);

public record DashboardFilterPanelDto(
    int DashboardId,
    IReadOnlyList<FilterMetadataDto> GlobalFilters,
    Dictionary<string, List<FilterMetadataDto>> LocalFilters
);

public record ExecuteWidgetQueryRequest(
    int DashboardId,
    string WidgetInstanceId,
    Dictionary<string, object> Filters
);

public record FilterValuesRequest(
    int FilterId,
    Dictionary<string, object>? ParentValues
);
