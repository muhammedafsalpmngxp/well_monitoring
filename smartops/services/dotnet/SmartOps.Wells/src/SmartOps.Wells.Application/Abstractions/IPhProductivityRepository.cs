using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Abstractions;

/// <summary>
/// Repository interface for the PH Productivity Weekly Report.
/// Computes productivity from 7 source tables: task_daily, ActivityCodesNorms,
/// Employee, ProjectIDs, OLD_NEW_CREW_MAPPING, CrewType, ActivityMasterCSV.
/// </summary>
public interface IPhProductivityRepository
{
    /// <summary>
    /// Returns the full PH Productivity Weekly Report for the given date range.
    /// Optionally filtered by category (nimr/marmul).
    /// </summary>
    Task<PhProductivityReportResponse> GetReportAsync(
        string fromDate,
        string toDate,
        string? category = null,
        CancellationToken ct = default);
}
