namespace TWise.Tenant.Infrastructure.Reporting;

public sealed class ReportJsonConfig
{
    public string? Title { get; set; }
    public List<ReportColumnConfig> Columns { get; set; } = new();
    public List<ReportFilterConfig>? Filters { get; set; }
    public List<ReportSortConfig>? SortBy { get; set; }
    public string? GroupBy { get; set; }
    public string PageOrientation { get; set; } = "Portrait";
    public string PageSize { get; set; } = "A4";
}

public sealed class ReportColumnConfig
{
    public string Field { get; set; } = string.Empty;
    public string Header { get; set; } = string.Empty;
    public string? Width { get; set; }
    public string Type { get; set; } = "string";
    public string? Format { get; set; }
    public bool Shown { get; set; } = true;
    public string? Group { get; set; }
    public string? SubGroup { get; set; }
    public string? Total { get; set; }
}

public sealed class ReportFilterConfig
{
    public string Field { get; set; } = string.Empty;
    public string? Key { get; set; }
    public string Operator { get; set; } = "eq";
    public string? Value { get; set; }
}

public sealed class ReportSortConfig
{
    public string Field { get; set; } = string.Empty;
    public string Direction { get; set; } = "asc";
}
