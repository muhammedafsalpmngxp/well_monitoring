using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using System.Text.Json.Nodes;

namespace TWise.Tenant.Infrastructure.Services;

public class ReportService(IReportRepository repo) : IReportService
{
    private const string CopyMetaKey = "_meta";
    private const string CopiedFromReportIdKey = "copiedFromReportId";
    // -- GET ALL --------------------------------------------------------------
    public async Task<IReadOnlyList<ReportDto>> GetAllAsync(string? status, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var reports = await repo.GetFilteredAsync(status, userId, isAdmin, ct);
        return reports.Select(ToDto).ToList();
    }

    // -- GET BY ID (read-only — owner or published) -------------------------
    public async Task<ReportDto?> GetByIdAsync(long id, long userId, CancellationToken ct = default)
    {
        var report = await repo.GetByIdForReadAsync(id, userId, ct);
        return report is null ? null : ToDto(report);
    }

    // -- CREATE ---------------------------------------------------------------
    public async Task<ReportDto> CreateAsync(CreateReportRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        if (await repo.ExistsDuplicateAsync(request.ReportName, request.SourceName, userId, ct))
            throw new InvalidOperationException(
                $"You already have a report named '{request.ReportName}' with source '{request.SourceName}'.");

        var report = new Report
        {
            ReportName = request.ReportName,
            Description = request.Description,
            CategoryId = request.CategoryId,
            SourceName = request.SourceName,
            SourceType = request.SourceType,
            ReportJson = request.ReportJson,
            Status     = "draft",
            IsDeleted  = false,
            CreatedBy  = userId,
            TenantId   = tenantId,
            CreatedAt  = DateTime.UtcNow,
            UpdatedAt  = DateTime.UtcNow
        };

        var saved = await repo.CreateAndLoadCategoryAsync(report, ct);
        return ToDto(saved);
    }

    public async Task<ReportDto?> CopyToDraftAsync(long id, long userId, bool isAdmin, long tenantId, CancellationToken ct = default)
    {
        if (!isAdmin) throw new UnauthorizedAccessException("Only administrators can copy published reports.");
        var source = await repo.GetByIdForReadAsync(id, userId, ct);
        if (source is null || source.Status != "published") return null;

        var name = source.ReportName + " copy";
        var suffix = 2;
        while (await repo.ExistsDuplicateAsync(name, source.SourceName, userId, ct))
            name = source.ReportName + " copy " + suffix++;

        var copy = new Report
        {
            ReportName = name, Description = source.Description, CategoryId = source.CategoryId, SourceName = source.SourceName,
            SourceType = source.SourceType, ReportJson = WithCopiedFrom(source.ReportJson, source.Id),
            Status = "draft", CreatedBy = userId, TenantId = tenantId,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, IsDeleted = false,
        };
        return ToDto(await repo.CreateAndLoadCategoryAsync(copy, ct));
    }

    // -- UPDATE ---------------------------------------------------------------
    public async Task<ReportDto?> UpdateAsync(long id, UpdateReportRequest request, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var report = await repo.GetByIdForUpdateAsync(id, userId, isAdmin, ct);
        if (report is null) return null;

        if (request.Status == "published" && !isAdmin)
            throw new UnauthorizedAccessException("Only administrators can publish reports.");

        var copiedFromId = GetCopiedFromReportId(report.ReportJson);
        var snapshotAfterSave = false;
        if (request.Status == "published" && copiedFromId is long sourceId)
        {
            var source = await repo.GetByIdForReadAsync(sourceId, userId, ct);
            if (source is null || source.Status != "published") return null;
            source.CategoryId = request.CategoryId;
            source.SourceName = request.SourceName;
            source.SourceType = request.SourceType;
            source.ReportJson = WithoutCopyMeta(request.ReportJson ?? report.ReportJson);
            source.UpdatedAt = DateTime.UtcNow;
            report.Status = "inactive";
            report.IsDeleted = true;
            report.UpdatedAt = DateTime.UtcNow;
            var merged = await repo.SaveAndLoadCategoryAsync(source, ct);
            await repo.SaveAndLoadCategoryAsync(report, ct);

            // This path overwrites the live report in place, so the previous definition would
            // be unrecoverable without a snapshot.
            await SnapshotAsync(merged, ReportVersionReasons.Publish, null, userId, ct);
            return ToDto(merged);
        }

        // A builder publish supplies ReportJson and persists every report edit.
        // Status-only publication leaves the existing report definition unchanged.
        if (request.Status == "published")
        {
            if (request.ReportJson is not null)
            {
                report.ReportName = request.ReportName;
                report.Description = request.Description;
                report.CategoryId = request.CategoryId;
                report.SourceName = request.SourceName;
                report.SourceType = request.SourceType;
                report.ReportJson = request.ReportJson;
            }
            report.Status = "published";
            report.PublishedOn = DateTime.UtcNow;
            report.UpdatedAt = DateTime.UtcNow;
            snapshotAfterSave = true;
        }
        else
        {
            // Editing a published report reverts it to draft (must be re-published)
            var wasPreviouslyPublished = report.Status == "published";
            var nextReportJson = request.ReportJson ?? report.ReportJson;

            report.ReportName = request.ReportName;
            report.Description = request.Description;
            report.CategoryId = request.CategoryId;
            report.SourceName = request.SourceName;
            report.SourceType = request.SourceType;
            report.ReportJson = copiedFromId is long sourceIdForDraft
                ? WithCopiedFrom(nextReportJson, sourceIdForDraft)
                : nextReportJson;
            report.Status     = wasPreviouslyPublished ? "draft" : request.Status;
            report.UpdatedAt  = DateTime.UtcNow;
        }

        var saved = await repo.SaveAndLoadCategoryAsync(report, ct);

        if (snapshotAfterSave)
            await SnapshotAsync(saved, ReportVersionReasons.Publish, null, userId, ct);

        return ToDto(saved);
    }

    // -- VERSION HISTORY ------------------------------------------------------

    public async Task<IReadOnlyList<ReportVersionSummaryDto>?> GetVersionsAsync(
        long id, long userId, long tenantId, CancellationToken ct = default)
    {
        var report = await repo.GetByIdForReadAsync(id, userId, ct);
        if (report is null) return null;

        var versions = await repo.GetVersionsAsync(id, tenantId, ct);
        if (versions.Count == 0) return Array.Empty<ReportVersionSummaryDto>();

        // The newest snapshot is what the live report currently reflects.
        var currentVersionNo = versions.Max(v => v.VersionNo);

        return versions.Select(v => new ReportVersionSummaryDto(
            v.VersionNo, v.ReportName, v.Description, v.SourceName, v.SourceType,
            v.Reason, v.RestoredFromVersionNo, v.PublishedBy, v.PublishedAt,
            IsCurrent: v.VersionNo == currentVersionNo)).ToList();
    }

    public async Task<RestoreReportVersionResponse?> RestoreVersionAsync(
        long id, int versionNo, long userId, bool isAdmin, long tenantId, CancellationToken ct = default)
    {
        // Restoring changes what every viewer sees, so it is gated like publishing.
        if (!isAdmin)
            throw new UnauthorizedAccessException("Only administrators can restore a report version.");

        var report = await repo.GetByIdForUpdateAsync(id, userId, isAdmin, ct);
        if (report is null) return null;

        var snapshot = await repo.GetVersionAsync(id, versionNo, tenantId, ct);
        if (snapshot is null)
            throw new InvalidOperationException($"Version {versionNo} does not exist for this report.");

        var maxVersionNo = await repo.GetMaxVersionNoAsync(id, ct);

        // Restoring the version already live would append an identical snapshot for no benefit.
        if (maxVersionNo == versionNo)
            throw new InvalidOperationException($"Version {versionNo} is already the current published version.");

        // Replay the snapshot onto the live report. The name is intentionally left alone:
        // renaming a report out from under its viewers is not part of a content rollback.
        report.Description = snapshot.Description;
        report.CategoryId = snapshot.CategoryId;
        report.SourceName = snapshot.SourceName;
        report.SourceType = snapshot.SourceType;
        report.ReportJson = snapshot.ReportJson;
        report.Status = "published";
        report.PublishedOn = DateTime.UtcNow;
        report.UpdatedAt = DateTime.UtcNow;

        var saved = await repo.SaveAndLoadCategoryAsync(report, ct);

        var newVersion = await SnapshotAsync(saved, ReportVersionReasons.Restore, versionNo, userId, ct);

        return new RestoreReportVersionResponse(
            saved.Id, versionNo, newVersion.VersionNo, saved.Status,
            $"'{saved.ReportName}' has been restored from v{versionNo} and published as v{newVersion.VersionNo}.");
    }

    /// <summary>
    /// Appends an immutable snapshot of the report as it now stands. Version numbers are
    /// assigned here so every caller gets a consistent, gap-free sequence per report.
    /// </summary>
    private async Task<ReportVersion> SnapshotAsync(
        Report report, string reason, int? restoredFromVersionNo, long userId, CancellationToken ct)
    {
        var maxVersionNo = await repo.GetMaxVersionNoAsync(report.Id, ct);

        var version = new ReportVersion
        {
            ReportId = report.Id,
            VersionNo = (maxVersionNo ?? -1) + 1,
            ReportName = report.ReportName,
            Description = report.Description,
            CategoryId = report.CategoryId,
            SourceName = report.SourceName,
            SourceType = report.SourceType,
            ReportJson = report.ReportJson,
            Reason = reason,
            RestoredFromVersionNo = restoredFromVersionNo,
            PublishedBy = userId,
            PublishedAt = DateTime.UtcNow,
            TenantId = report.TenantId
        };

        return await repo.AddVersionAsync(version, ct);
    }

    // -- DELETE ---------------------------------------------------------------
    public Task<bool> DeleteAsync(long id, long userId, CancellationToken ct = default)
        => repo.SoftDeleteAsync(id, userId, ct);

    // -- Mapper ---------------------------------------------------------------
    private static ReportDto ToDto(Report r) => new(
        r.Id,
        r.ReportName,
        r.Description,
        r.CategoryId,
        r.Category?.CategoryName,
        r.SourceName,
        r.SourceType,
        r.ReportJson,
        r.Status,
        r.PublishedOn,
        r.CreatedBy,
        r.TenantId,
        r.CreatedAt,
        r.UpdatedAt,
        CategoryDescription: r.Category?.Description
    );

    private static string? WithCopiedFrom(string? json, long id)
    {
        JsonObject root;
        try { root = JsonNode.Parse(json ?? "{}") as JsonObject ?? new JsonObject(); }
        catch { root = new JsonObject(); }
        root[CopyMetaKey] = new JsonObject { [CopiedFromReportIdKey] = id };
        return root.ToJsonString();
    }

    private static long? GetCopiedFromReportId(string? json)
    {
        try
        {
            if (JsonNode.Parse(json ?? "") is JsonObject root && root[CopyMetaKey] is JsonObject meta &&
                meta[CopiedFromReportIdKey] is JsonNode id && id.AsValue().TryGetValue<long>(out var value)) return value;
        }
        catch { }
        return null;
    }

    private static string? WithoutCopyMeta(string? json)
    {
        try { if (JsonNode.Parse(json ?? "") is JsonObject root) { root.Remove(CopyMetaKey); return root.ToJsonString(); } }
        catch { }
        return json;
    }
}
