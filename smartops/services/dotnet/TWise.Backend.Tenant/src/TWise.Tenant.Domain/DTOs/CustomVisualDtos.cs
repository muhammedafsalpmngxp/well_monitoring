namespace TWise.Tenant.Domain.DTOs;

/// <summary>One field a custom visual needs, as shown in the builder's field pickers.</summary>
/// <param name="Key">Placeholder name used in the options template, e.g. <c>category</c>.</param>
/// <param name="Label">Shown beside the picker.</param>
/// <param name="Type">dimension | measure.</param>
/// <param name="Required">Blocks saving the widget when unmapped.</param>
/// <param name="AllowMultiple">True when the role accepts several columns (e.g. multi-series).</param>
public record CustomVisualDataRole(
    string Key,
    string Label,
    string Type,
    bool Required = true,
    bool AllowMultiple = false
);

public record CustomVisualDto(
    long Id,
    string VisualKey,
    string DisplayName,
    string? Description,
    string? Icon,
    string RenderKind,
    IReadOnlyList<CustomVisualDataRole> DataRoles,
    string OptionsTemplateJson,
    bool IsActive,
    DateTime CreatedAt,
    DateTime ModifiedAt
);

public record CreateCustomVisualRequest(
    string VisualKey,
    string DisplayName,
    string OptionsTemplateJson,
    IReadOnlyList<CustomVisualDataRole> DataRoles,
    string? Description = null,
    string? Icon = null,
    string RenderKind = "highcharts-template",
    bool IsActive = true
);

public record UpdateCustomVisualRequest(
    string DisplayName,
    string OptionsTemplateJson,
    IReadOnlyList<CustomVisualDataRole> DataRoles,
    string? Description,
    string? Icon,
    bool IsActive
);

/// <summary>
/// Outcome of validating a visual definition. Returned before save and from the preview
/// endpoint, so an author sees what is wrong rather than a widget that renders blank.
/// </summary>
public record CustomVisualValidationResult(
    bool IsValid,
    IReadOnlyList<string> Errors,
    IReadOnlyList<string> Warnings
);
