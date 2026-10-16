namespace SmartOps.Wells.Contracts;

public sealed record PhProductivityReportResponse(
    IReadOnlyList<PhProductivityRowDto> Data,
    int TotalRows,
    IReadOnlyList<string> MonthsCovered,
    DateTime GeneratedAt
);

public sealed record PhProductivityRowDto(
    int SNo,
    string Month,
    int Year,
    string MonthStart,
    string PaName,
    string PhEmpId,
    string PhName,
    string AtnmSubContractor,
    string Category,
    string CrewType,
    string CrewDiscipline,
    string CrewName,
    decimal? AverageProductivity,
    string? W1PiCmr,
    string? W1PiTWise,
    string? W2PiCmr,
    string? W2PiTWise,
    string? W3PiCmr,
    string? W3PiTWise,
    string? W4PiCmr,
    string? W4PiTWise,
    string? W5PiCmr,
    string? W5PiTWise,
    string? MonthPiCmr,
    string? MonthPiTWise
);
