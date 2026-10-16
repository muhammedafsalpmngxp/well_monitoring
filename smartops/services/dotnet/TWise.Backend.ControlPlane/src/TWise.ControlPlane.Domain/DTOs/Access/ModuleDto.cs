namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record ModuleDto(
    int ModuleId, string ModuleCode, string? ParentCode,
    string? DisplayName, string? FeatureCode, int SortOrder, bool IsActive);

public record ModuleCreateRequest(
    string ModuleCode, string? ParentCode,
    string? DisplayName, string? FeatureCode, int SortOrder = 0, bool IsActive = true);

public record ModuleUpdateRequest(
    string ModuleCode, string? ParentCode,
    string? DisplayName, string? FeatureCode, int SortOrder = 0, bool IsActive = true);

public record ModuleTreeNode(
    string ModuleCode, string? ParentCode, string? DisplayName,
    string? FeatureCode, int SortOrder, List<ModuleTreeNode> Children);
