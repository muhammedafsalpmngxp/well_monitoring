using MediatR;
using Microsoft.Extensions.Logging;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Dashboards;

public static class DashboardShareLink
{
    private const string TokenHashProperty = "publicShareTokenHash";
    private const string SharedUserIdsProperty = "sharedWithUserIds";

    public static string CreateToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static string WithTokenHash(string? configJson, string tokenHash)
    {
        var root = ParseConfig(configJson);
        var metadata = root["_meta"] as JsonObject ?? new JsonObject();
        metadata[TokenHashProperty] = tokenHash;
        root["_meta"] = metadata;
        return root.ToJsonString();
    }

    public static bool HasToken(string? configJson, string token)
    {
        if (string.IsNullOrWhiteSpace(configJson) || string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            var storedHash = JsonNode.Parse(configJson)?["_meta"]?[TokenHashProperty]?.GetValue<string>();
            return !string.IsNullOrWhiteSpace(storedHash)
                && CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(storedHash), Convert.FromHexString(HashToken(token)));
        }
        catch { return false; }
    }

    /// <summary>Adds the given user IDs to the dashboard's internal-share list (union, no duplicates).</summary>
    public static string WithAdditionalSharedUserIds(string? configJson, IEnumerable<long> userIds)
    {
        var root = ParseConfig(configJson);
        var metadata = root["_meta"] as JsonObject ?? new JsonObject();
        var merged = GetSharedUserIds(configJson).Concat(userIds).Distinct().OrderBy(id => id).ToList();
        metadata[SharedUserIdsProperty] = new JsonArray(merged.Select(id => (JsonNode?)JsonValue.Create(id)).ToArray());
        root["_meta"] = metadata;
        return root.ToJsonString();
    }

    public static IReadOnlyList<long> GetSharedUserIds(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return [];
        try
        {
            return JsonNode.Parse(configJson)?["_meta"]?[SharedUserIdsProperty]?.AsArray()
                .Select(n => n?.GetValue<long>())
                .OfType<long>()
                .ToList() ?? [];
        }
        catch { return []; }
    }

    /// <summary>
    /// Re-applies the previous ConfigJson's `_meta` block (share token hash, shared-user list, copy
    /// marker, etc.) onto a freshly-saved ConfigJson — builder saves overwrite ConfigJson wholesale
    /// and would otherwise silently wipe this hidden metadata.
    /// </summary>
    public static string? PreserveMeta(string? previousConfigJson, string? nextConfigJson)
    {
        if (string.IsNullOrWhiteSpace(previousConfigJson)) return nextConfigJson;
        try
        {
            var previousMeta = JsonNode.Parse(previousConfigJson)?["_meta"] as JsonObject;
            if (previousMeta is null) return nextConfigJson;
            var nextRoot = ParseConfig(nextConfigJson);
            nextRoot["_meta"] = JsonNode.Parse(previousMeta.ToJsonString());
            return nextRoot.ToJsonString();
        }
        catch { return nextConfigJson; }
    }

    private static JsonObject ParseConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return new JsonObject();
        try { return JsonNode.Parse(configJson) as JsonObject ?? new JsonObject(); }
        catch { return new JsonObject(); }
    }
}

public sealed class CreateDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<CreateDashboardHandler> logger) : IRequestHandler<CreateDashboardCommand, Result<CreateDashboardResponse>>
{
    public async Task<Result<CreateDashboardResponse>> Handle(CreateDashboardCommand cmd, CancellationToken ct)
    {
        var request = cmd.Request;

        if (string.IsNullOrWhiteSpace(request.DashboardName))
            return Result<CreateDashboardResponse>.ValidationError("Dashboard Name is required.");

        logger.LogInformation("Dashboard creation started. Name={Name}, CategoryId={CategoryId}",
            request.DashboardName, request.CategoryId);

        // Category must exist
        var categoryExists = await repo.CategoryExistsAsync(request.CategoryId, ct);
        if (!categoryExists)
            return Result<CreateDashboardResponse>.ValidationError("Category does not exist.");

        // Duplicate check
        var exists = await repo.DashboardExistsAsync(request.DashboardName.Trim(), request.CategoryId, ct);
        if (exists)
            return Result<CreateDashboardResponse>.Conflict("Dashboard with same name already exists in this category.");

        // Create
        var userId = currentUser.UserId ?? "system";
        var dashboard = new Dashboard
        {
            DashboardName = request.DashboardName.Trim(),
            CategoryId = request.CategoryId,
            Description = request.Description?.Trim(),
            ConfigJson = request.ConfigJson,
            Status = DashboardStatus.Draft,
            CreatedBy = userId,
            ModifiedBy = userId
        };

        var created = await repo.CreateDashboardAsync(dashboard, ct);

        logger.LogInformation("Dashboard created successfully. DashboardId={DashboardId}", created.DashboardId);

        var response = new CreateDashboardResponse
        {
            DashboardId = created.DashboardId,
            DashboardName = created.DashboardName,
            CategoryId = created.CategoryId,
            Status = created.Status,
            Message = $"Dashboard '{created.DashboardName}' has been created successfully."
        };

        return Result<CreateDashboardResponse>.Success(response);
    }
}

public sealed class CreateDashboardShareLinkHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<CreateDashboardShareLinkHandler> logger) : IRequestHandler<CreateDashboardShareLinkCommand, Result<DashboardShareLinkResponse>>
{
    public async Task<Result<DashboardShareLinkResponse>> Handle(CreateDashboardShareLinkCommand command, CancellationToken ct)
    {
        var dashboard = await repo.GetDashboardByIdAsync(command.DashboardId, ct);
        if (dashboard is null)
            return Result<DashboardShareLinkResponse>.NotFound($"Dashboard with ID {command.DashboardId} not found.");

        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(role => role.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin && !string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase))
            return Result<DashboardShareLinkResponse>.Forbidden("You can only share dashboards you created.");

        var token = DashboardShareLink.CreateToken();
        dashboard.ConfigJson = DashboardShareLink.WithTokenHash(dashboard.ConfigJson, DashboardShareLink.HashToken(token));
        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;
        await repo.UpdateDashboardConfigAsync(dashboard, ct);

        logger.LogInformation("Created external share link for dashboard {DashboardId}.", dashboard.DashboardId);
        return Result<DashboardShareLinkResponse>.Success(new DashboardShareLinkResponse
        {
            DashboardId = dashboard.DashboardId,
            Token = token
        });
    }
}

public sealed class ShareDashboardInternallyHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    IControlPlaneNotificationClient notifications,
    ILogger<ShareDashboardInternallyHandler> logger,
    ICategoryRepository categories,
    IWidgetService widgets) : IRequestHandler<ShareDashboardInternallyCommand, Result<ShareDashboardInternallyResponse>>
{
    public async Task<Result<ShareDashboardInternallyResponse>> Handle(ShareDashboardInternallyCommand command, CancellationToken ct)
    {
        if (command.UserIds.Count == 0 || command.UserIds.Any(id => id <= 0))
            return Result<ShareDashboardInternallyResponse>.ValidationError("Select at least one user to share with.");

        var dashboard = await repo.GetDashboardByIdAsync(command.DashboardId, ct);
        if (dashboard is null)
            return Result<ShareDashboardInternallyResponse>.NotFound($"Dashboard with ID {command.DashboardId} not found.");

        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(role => role.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin && !string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase))
            return Result<ShareDashboardInternallyResponse>.Forbidden("You can only share dashboards you created.");

        var previousConfig = dashboard.ConfigJson;
        var previousMetadata = string.IsNullOrWhiteSpace(previousConfig) ? null : JsonNode.Parse(previousConfig)?["_meta"];
        var legacyRecipients = previousMetadata?["independentShares"]?.GetValue<bool>() == true
            || previousMetadata?["sharedRecipientId"] is not null
            ? Array.Empty<long>() : DashboardShareLink.GetSharedUserIds(previousConfig);
        var recipientIds = command.UserIds.Concat(legacyRecipients).Distinct().ToArray();
        List<(long RecipientId, int DashboardId)> copies;
        try
        {
            copies = await repo.ExecuteInTransactionAsync(async () =>
            {
                var createdCopies = new List<(long RecipientId, int DashboardId)>();
                foreach (var recipientId in recipientIds)
                {
                    var result = await DashboardSharedCopy.CreateAsync(repo, categories, widgets, dashboard,
                        new SaveDashboardRequest
                        {
                            DashboardName = dashboard.DashboardName,
                            CategoryId = dashboard.CategoryId,
                            Description = dashboard.Description,
                            ConfigJson = previousConfig
                        }, recipientId.ToString(System.Globalization.CultureInfo.InvariantCulture), ct, sharedAtCreation: true);
                    if (!result.IsSuccess)
                        throw new InvalidOperationException(result.ErrorMessage ?? "Unable to copy the shared dashboard.");
                    createdCopies.Add((recipientId, result.Value!.DashboardId));
                }

                dashboard.ConfigJson = DashboardShareLink.WithAdditionalSharedUserIds(previousConfig, command.UserIds);
                var config = JsonNode.Parse(dashboard.ConfigJson)!.AsObject();
                config["_meta"]!["independentShares"] = true;
                dashboard.ConfigJson = config.ToJsonString();
                dashboard.ModifiedBy = userId;
                dashboard.ModifiedAt = DateTime.UtcNow;
                await repo.UpdateDashboardConfigAsync(dashboard, ct);
                return createdCopies;
            }, ct);
        }
        catch (InvalidOperationException exception)
        {
            return Result<ShareDashboardInternallyResponse>.ValidationError(exception.Message);
        }

        var totalShared = DashboardShareLink.GetSharedUserIds(dashboard.ConfigJson).Count;
        logger.LogInformation("Shared dashboard {DashboardId} internally with {Count} user(s).", dashboard.DashboardId, command.UserIds.Count);

        foreach (var copy in copies)
            await notifications.PublishAsync(command.TenantId, "DashboardShare", "Dashboard shared with you",
                $"\"{dashboard.DashboardName}\" was shared with you", $"/dashboard/shared/{copy.DashboardId}",
                new[] { copy.RecipientId }, null, ct);

        return Result<ShareDashboardInternallyResponse>.Success(new ShareDashboardInternallyResponse
        {
            DashboardId = dashboard.DashboardId,
            SharedWithCount = totalShared
        });
    }
}

public sealed class PublishDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<PublishDashboardHandler> logger) : IRequestHandler<PublishDashboardCommand, Result<PublishDashboardResponse>>
{
    public async Task<Result<PublishDashboardResponse>> Handle(PublishDashboardCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Publishing dashboard. DashboardId={DashboardId}", cmd.DashboardId);

        var hasAdminRole = currentUser.Roles.Any(IsAdminRole);
        if (!hasAdminRole)
            return Result<PublishDashboardResponse>.Forbidden("Only admin users can publish dashboards.");

        // Validate dashboard exists
        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<PublishDashboardResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        // Validate status
        if (dashboard.Status == DashboardStatus.Published)
            return Result<PublishDashboardResponse>.Conflict("This dashboard is already published. No changes were made.");

        if (dashboard.Status != DashboardStatus.Draft && dashboard.Status != DashboardStatus.Completed)
            return Result<PublishDashboardResponse>.ValidationError("Only dashboards with status 'Draft' or 'Completed' can be published. Current status: " + dashboard.Status + ".");

        var userId = currentUser.UserId ?? "system";

        // If a previous published version exists for this series, this draft becomes the
        // NEXT version instead of a disconnected board — the old version is archived
        // (kept, not deleted) so its history stays browsable, and the canonical (suffix-free)
        // name is restored. The next version number always comes from the highest VersionNo
        // ever used in the series (not from IsLatestVersion), because IsLatestVersion is
        // already false right after an Unpublish — relying on it alone would make version
        // numbers incorrectly restart at 0 for a draft descended from an unpublished board.
        var previousLatest = await repo.GetLatestVersionAsync(dashboard.DashboardSeriesId, ct);
        var maxVersionNo = await repo.GetMaxVersionNoAsync(dashboard.DashboardSeriesId, ct);

        if (previousLatest is not null)
        {
            previousLatest.IsLatestVersion = false;
            previousLatest.ModifiedBy = userId;
            previousLatest.ModifiedAt = DateTime.UtcNow;

            dashboard.DashboardName = previousLatest.DashboardName;
        }

        dashboard.VersionNo = (maxVersionNo ?? -1) + 1;

        dashboard.Status = DashboardStatus.Published;
        dashboard.IsLatestVersion = true;
        dashboard.PublishedBy = userId;
        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.PublishNewVersionAsync(previousLatest, dashboard, ct);

        logger.LogInformation("Dashboard published successfully. DashboardId={DashboardId}, VersionNo={VersionNo}", dashboard.DashboardId, dashboard.VersionNo);

        return Result<PublishDashboardResponse>.Success(new PublishDashboardResponse
        {
            DashboardId = dashboard.DashboardId,
            Status = dashboard.Status,
            Message = "'" + dashboard.DashboardName + "' has been published as v" + dashboard.VersionNo + "."
        });
    }

    private static bool IsAdminRole(string role) => role.Equals("admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenant_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenantadmin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platform_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platformadmin", StringComparison.OrdinalIgnoreCase);
}

public sealed class UnpublishDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<UnpublishDashboardHandler> logger) : IRequestHandler<UnpublishDashboardCommand, Result<PublishDashboardResponse>>
{
    public async Task<Result<PublishDashboardResponse>> Handle(UnpublishDashboardCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Unpublishing dashboard. DashboardId={DashboardId}", cmd.DashboardId);

        var hasAdminRole = currentUser.Roles.Any(IsAdminRole);
        if (!hasAdminRole)
            return Result<PublishDashboardResponse>.Forbidden("Only admin users can unpublish dashboards.");

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<PublishDashboardResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        if (dashboard.Status != DashboardStatus.Published)
            return Result<PublishDashboardResponse>.Conflict("Only published dashboards can be unpublished.");

        var userId = currentUser.UserId ?? "system";

        // Archive the published version in place (kept for history, no longer "latest")
        // instead of flipping it back to Draft — a new (or already-open) draft row carries
        // the edits forward so the version that was actually live is never lost.
        dashboard.IsLatestVersion = false;
        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;

        var existingDraft = await repo.GetActiveDraftForSeriesAsync(dashboard.DashboardSeriesId, ct);
        var newDraft = existingDraft ?? new Dashboard
        {
            // No "copy" suffix here: the live published board is being archived by this
            // very action, so there's no other row left with this name to clash with.
            DashboardName = dashboard.DashboardName,
            DashboardSeriesId = dashboard.DashboardSeriesId,
            CategoryId = dashboard.CategoryId,
            Description = dashboard.Description,
            ConfigJson = dashboard.ConfigJson,
            Status = DashboardStatus.Draft,
            VersionNo = null,
            IsLatestVersion = false,
            CreatedBy = userId,
            ModifiedBy = userId
        };

        await repo.UnpublishToNewDraftAsync(dashboard, existingDraft is null ? newDraft : null, ct);

        return Result<PublishDashboardResponse>.Success(new PublishDashboardResponse
        {
            DashboardId = newDraft.DashboardId,
            Status = newDraft.Status,
            Message = $"'{dashboard.DashboardName}' has been unpublished and moved to WIP Boards for editing."
        });
    }

    private static bool IsAdminRole(string role) => role.Equals("admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenant_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenantadmin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platform_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platformadmin", StringComparison.OrdinalIgnoreCase);
}

public sealed class CompleteDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<CompleteDashboardHandler> logger) : IRequestHandler<CompleteDashboardCommand, Result<CompleteDashboardResponse>>
{
    public async Task<Result<CompleteDashboardResponse>> Handle(CompleteDashboardCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Completing dashboard. DashboardId={DashboardId}", cmd.DashboardId);

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<CompleteDashboardResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin && !string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase))
            return Result<CompleteDashboardResponse>.Forbidden("You can only complete dashboards you created.");

        if (dashboard.Status == DashboardStatus.Completed)
            return Result<CompleteDashboardResponse>.Conflict("This dashboard is already completed.");

        if (dashboard.Status != DashboardStatus.Draft)
            return Result<CompleteDashboardResponse>.ValidationError("Only dashboards with status 'Draft' can be completed. Current status: " + dashboard.Status + ".");

        dashboard.Status = DashboardStatus.Completed;
        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateDashboardAsync(dashboard, ct);

        return Result<CompleteDashboardResponse>.Success(new CompleteDashboardResponse
        {
            DashboardId = dashboard.DashboardId,
            Status = dashboard.Status,
            Message = "Dashboard '" + dashboard.DashboardName + "' has been marked as completed."
        });
    }
}

public sealed class ReopenDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<ReopenDashboardHandler> logger) : IRequestHandler<ReopenDashboardCommand, Result<ReopenDashboardResponse>>
{
    public async Task<Result<ReopenDashboardResponse>> Handle(ReopenDashboardCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Reopening dashboard. DashboardId={DashboardId}", cmd.DashboardId);

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<ReopenDashboardResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin && !string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase))
            return Result<ReopenDashboardResponse>.Forbidden("You can only reopen dashboards you created.");

        if (dashboard.Status != DashboardStatus.Completed)
            return Result<ReopenDashboardResponse>.ValidationError("Only dashboards with status 'Completed' can be reopened. Current status: " + dashboard.Status + ".");

        dashboard.Status = DashboardStatus.Draft;
        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateDashboardAsync(dashboard, ct);

        return Result<ReopenDashboardResponse>.Success(new ReopenDashboardResponse
        {
            DashboardId = dashboard.DashboardId,
            Status = dashboard.Status,
            Message = "'" + dashboard.DashboardName + "' has been moved back to Draft."
        });
    }
}

public sealed class RestoreDashboardVersionHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<RestoreDashboardVersionHandler> logger)
    : IRequestHandler<RestoreDashboardVersionCommand, Result<RestoreDashboardVersionResponse>>
{
    public async Task<Result<RestoreDashboardVersionResponse>> Handle(RestoreDashboardVersionCommand cmd, CancellationToken ct)
    {
        logger.LogInformation(
            "Restoring dashboard version. DashboardId={DashboardId}, VersionNo={VersionNo}",
            cmd.DashboardId, cmd.VersionNo);

        // Restoring changes what every viewer sees, so it is gated like publishing.
        if (!currentUser.Roles.Any(IsAdminRole))
            return Result<RestoreDashboardVersionResponse>.Forbidden("Only admin users can restore a dashboard version.");

        var anchorDashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (anchorDashboard is null)
            return Result<RestoreDashboardVersionResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        var seriesId = anchorDashboard.DashboardSeriesId;

        var sourceVersion = await repo.GetVersionAsync(seriesId, cmd.VersionNo, ct);
        if (sourceVersion is null)
            return Result<RestoreDashboardVersionResponse>.NotFound(
                $"Version {cmd.VersionNo} does not exist for this dashboard.");

        var previousLatest = await repo.GetLatestVersionAsync(seriesId, ct);

        // Restoring the version that is already live would add an identical version for no
        // benefit, so it is rejected rather than silently cluttering the history.
        if (previousLatest is not null && previousLatest.VersionNo == cmd.VersionNo)
            return Result<RestoreDashboardVersionResponse>.Conflict(
                $"Version {cmd.VersionNo} is already the current published version.");

        var maxVersionNo = await repo.GetMaxVersionNoAsync(seriesId, ct);
        var newVersionNo = (maxVersionNo ?? -1) + 1;
        var userId = currentUser.UserId ?? "system";
        var now = DateTime.UtcNow;

        if (previousLatest is not null)
        {
            previousLatest.IsLatestVersion = false;
            previousLatest.ModifiedBy = userId;
            previousLatest.ModifiedAt = now;
        }

        // Append-only: the restored content becomes a NEW version rather than reactivating the
        // old row. The history stays intact, so an audit can still see the faulty version that
        // prompted the rollback and exactly when it was superseded.
        var restored = new Dashboard
        {
            DashboardName = (previousLatest ?? sourceVersion).DashboardName,
            DashboardSeriesId = seriesId,
            CategoryId = sourceVersion.CategoryId,
            Description = sourceVersion.Description,
            ConfigJson = sourceVersion.ConfigJson,
            Status = DashboardStatus.Published,
            VersionNo = newVersionNo,
            IsLatestVersion = true,
            IsActive = true,
            PublishedBy = userId,
            CreatedBy = userId,
            ModifiedBy = userId,
            ModifiedAt = now
        };

        var created = await repo.RestoreVersionAsync(previousLatest, restored, ct);

        logger.LogInformation(
            "Dashboard version restored. SeriesId={SeriesId}, RestoredFrom=v{FromVersion}, NewVersion=v{NewVersion}, DashboardId={DashboardId}",
            seriesId, cmd.VersionNo, newVersionNo, created.DashboardId);

        return Result<RestoreDashboardVersionResponse>.Success(new RestoreDashboardVersionResponse
        {
            DashboardId = created.DashboardId,
            RestoredFromVersionNo = cmd.VersionNo,
            NewVersionNo = newVersionNo,
            Status = created.Status,
            Message = $"'{created.DashboardName}' has been restored from v{cmd.VersionNo} and published as v{newVersionNo}."
        });
    }

    private static bool IsAdminRole(string role) => role.Equals("admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenant_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenantadmin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platform_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platformadmin", StringComparison.OrdinalIgnoreCase);
}

public sealed class CopyDashboardToDraftHandler(
    IDashboardRepository repo,
    IDashboardSavedFilterRepository savedFilterRepo,
    ICurrentUserService currentUser,
    ILogger<CopyDashboardToDraftHandler> logger) : IRequestHandler<CopyDashboardToDraftCommand, Result<CreateDashboardResponse>>
{
    public async Task<Result<CreateDashboardResponse>> Handle(CopyDashboardToDraftCommand cmd, CancellationToken ct)
    {
        // Only admin can copy a Standard Board to draft.
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin)
            return Result<CreateDashboardResponse>.Forbidden("Only admin users can copy a dashboard to draft.");

        var source = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (source is null)
            return Result<CreateDashboardResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        // Editing an already-published board continues as a new version of the same
        // series, not a disconnected duplicate — reuse the pending draft if one is open.
        var existingDraft = await repo.GetActiveDraftForSeriesAsync(source.DashboardSeriesId, ct);
        if (existingDraft is not null)
        {
            return Result<CreateDashboardResponse>.Success(new CreateDashboardResponse
            {
                DashboardId = existingDraft.DashboardId,
                DashboardName = existingDraft.DashboardName,
                CategoryId = existingDraft.CategoryId,
                Status = existingDraft.Status,
                Message = $"'{existingDraft.DashboardName}' is already in WIP Boards."
            });
        }

        var userId = currentUser.UserId ?? "system";
        var copy = new Dashboard
        {
            DashboardName = $"{source.DashboardName} copy",
            DashboardSeriesId = source.DashboardSeriesId,
            CategoryId = source.CategoryId,
            Description = source.Description,
            ConfigJson = source.ConfigJson,
            Status = DashboardStatus.Draft,
            VersionNo = null,
            IsLatestVersion = false,
            CreatedBy = userId,
            ModifiedBy = userId
        };

        var created = await repo.CreateDashboardAsync(copy, ct);

        // Saved filters are scoped by DashboardId - the draft gets a new ID, so without this it
        // would always start with an empty Saved Filters list even though the source board had some.
        await savedFilterRepo.CopyAllAsync(source.DashboardId, created.DashboardId, ct);

        logger.LogInformation("Dashboard copied to draft. SourceId={SourceId}, NewId={NewId}", cmd.DashboardId, created.DashboardId);

        return Result<CreateDashboardResponse>.Success(new CreateDashboardResponse
        {
            DashboardId = created.DashboardId,
            DashboardName = created.DashboardName,
            CategoryId = created.CategoryId,
            Status = created.Status,
            Message = $"'{created.DashboardName}' has been added to WIP Boards."
        });
    }
}
