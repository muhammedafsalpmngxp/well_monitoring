namespace TWise.Tenant.Domain.DTOs;

/// <summary>Full data from a core schema table or view for live preview.</summary>
public record TableDataDto(
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, object?>> Rows,
    IReadOnlyDictionary<string, string>? ColumnTypes = null,
    IReadOnlyList<string>? PrimaryKeys = null
);

public record PlantFilterDto(
    int PlantCode,
    string PlantDescription,
    string Cluster,
    string Division,
    string BusinessUnit,
    string Sector,
    string Country
);

/// <summary>Reference options for the Advanced Filter panel, including resource values from ref.local_filters.</summary>
public sealed record AdvancedFilterDataDto(
    IReadOnlyList<OrgStructureRow> OrgStructure,
    IReadOnlyList<CompanyRow> Companies,
    IReadOnlyList<string> ResourceTypes,
    string? ResourceTypesError = null
);

public record OrgStructureRow(
    int PlantCode,
    string SiteManagerA,
    string SiteManagerB,
    string ClusterManager,
    int ProjectDirectorID,
    string ProjectDirectorName,
    string ExecutiveVicePresident,
    string CEO
);

public record CompanyRow(int CompanyId, string CompanyName);
