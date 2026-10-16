using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reports;

/// <summary>
/// UserId and TenantId are extracted from the JWT by the controller and injected here.
/// </summary>
public record CreateReportCommand(CreateReportRequest Request, long UserId, long TenantId) : IRequest<ReportDto>;

/// <summary>
/// Restore a report to an earlier published version. Append-only — the restore is itself
/// recorded as a new version, so history is preserved rather than rewritten.
/// </summary>
public record RestoreReportVersionCommand(long Id, int VersionNo, long UserId, bool IsAdmin, long TenantId)
    : IRequest<RestoreReportVersionResponse?>;
