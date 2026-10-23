using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Dashboards;

public sealed class CheckDashboardCommentAccessHandler(IDashboardPermissionService permissions)
    : IRequestHandler<CheckDashboardCommentAccessQuery, Result>
{
    public Task<Result> Handle(CheckDashboardCommentAccessQuery query, CancellationToken ct) =>
        permissions.CheckCommentAccessAsync(query.User, query.Action, query.TargetType,
            query.TargetId, query.CommentId, query.Create, ct);
}

public sealed class ResolveDashboardVersionAccessHandler(IDashboardPermissionService permissions)
    : IRequestHandler<ResolveDashboardVersionAccessQuery, Result<DashboardVersionAccess>>
{
    public Task<Result<DashboardVersionAccess>> Handle(ResolveDashboardVersionAccessQuery query, CancellationToken ct) =>
        permissions.ResolveVersionAccessAsync(query.User, query.DashboardId, query.IsHistoryRequest, ct);
}

public static class DashboardGroupingHelper
{
    public static int CountWidgetsFromConfig(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return 0;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(configJson);
            if (doc.RootElement.TryGetProperty("widgets", out var widgets) && widgets.ValueKind == System.Text.Json.JsonValueKind.Array)
                return widgets.GetArrayLength();
        }
        catch { /* malformed JSON */ }
        return 0;
    }

    public static IReadOnlyList<DashboardCategoryResponse> GroupByCategory(
        IReadOnlyList<Category> categories,
        IReadOnlyList<Dashboard> dashboards)
    {
        return categories.Select(c => new DashboardCategoryResponse
        {
            CategoryId = c.CategoryId,
            CategoryName = c.CategoryName,
            Description = c.Description,
            DashboardCount = dashboards.Count(d => d.CategoryId == c.CategoryId),
            Dashboards = dashboards.Where(d => d.CategoryId == c.CategoryId)
                .Select(d => ToSummary(d, c.CategoryName)).ToList()
        }).ToList();
    }

    public const string OthersGroupName = "Others";

    /// <summary>The user's boards that sit in a category someone else created, so they stay reachable to be moved.</summary>
    public static DashboardCategoryResponse OthersGroup(IReadOnlyList<Dashboard> dashboards) => new()
    {
        CategoryId = 0,
        CategoryName = OthersGroupName,
        DashboardCount = dashboards.Count,
        Dashboards = dashboards.Select(d => ToSummary(d, OthersGroupName)).ToList()
    };

    private static DashboardSummaryResponse ToSummary(Dashboard d, string categoryName) => new()
    {
        DashboardId = d.DashboardId,
        DashboardName = d.DashboardName,
        CategoryId = d.CategoryId,
        CategoryName = categoryName,
        Status = d.Status,
        Description = d.Description,
        WidgetCount = CountWidgetsFromConfig(d.ConfigJson),
        ModifiedDate = d.ModifiedAt,
        CreatedBy = d.CreatedBy,
        VersionNo = d.VersionNo
    };

    /// <summary>The rows of the requested kind (no kind means dashboards).</summary>
    // ponytail: filters in memory after the list query, as these lists already load every row with its ConfigJson; filter in SQL with JSON_VALUE if the lists grow large.
    public static IReadOnlyList<Dashboard> OfKind(IEnumerable<Dashboard> dashboards, string? kind)
        => dashboards.Where(d => DashboardKind.Matches(d.ConfigJson, kind)).ToList();
}

public sealed class GetWipDashboardsHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<GetWipDashboardsHandler> logger) : IRequestHandler<GetWipDashboardsQuery, Result<IReadOnlyList<DashboardCategoryResponse>>>
{
    public async Task<Result<IReadOnlyList<DashboardCategoryResponse>>> Handle(GetWipDashboardsQuery request, CancellationToken ct)
    {
        if (!DashboardKind.IsKnown(request.Kind))
            return Result<IReadOnlyList<DashboardCategoryResponse>>.ValidationError(DashboardKind.UnknownKindMessage);

        var userId = currentUser.UserId ?? "system";
        logger.LogInformation("Fetching WIP dashboards for user {UserId}.", userId);
        // Same rule as the Manage Category list: the default category plus the ones this user created.
        var categories = (await repo.GetDashboardCategoriesAsync(ct))
            .Where(c => c.CategoryId == 1 || c.CreatedBy == userId)
            .ToList();
        var dashboards = DashboardGroupingHelper.OfKind(await repo.GetDashboardsByCreatorAsync(userId,
            [DashboardStatus.Draft, DashboardStatus.Completed], ct), request.Kind);
        var groups = DashboardGroupingHelper.GroupByCategory(categories, dashboards).ToList();
        var ownIds = categories.Select(c => c.CategoryId).ToHashSet();
        var inOtherCategories = dashboards.Where(d => !ownIds.Contains(d.CategoryId)).ToList();
        if (inOtherCategories.Count > 0) groups.Add(DashboardGroupingHelper.OthersGroup(inOtherCategories));
        return Result<IReadOnlyList<DashboardCategoryResponse>>.Success(groups);
    }
}

public sealed class GetWipDashboardsMinimalHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser) : IRequestHandler<GetWipDashboardsMinimalQuery, Result<IReadOnlyList<DashboardMinimalResponse>>>
{
    public async Task<Result<IReadOnlyList<DashboardMinimalResponse>>> Handle(GetWipDashboardsMinimalQuery request, CancellationToken ct)
    {
        if (!DashboardKind.IsKnown(request.Kind))
            return Result<IReadOnlyList<DashboardMinimalResponse>>.ValidationError(DashboardKind.UnknownKindMessage);

        var userId = currentUser.UserId ?? "system";
        var dashboards = await repo.GetDashboardsByCreatorAsync(userId,
            [DashboardStatus.Draft, DashboardStatus.Completed], ct);
        IReadOnlyList<DashboardMinimalResponse> list = DashboardGroupingHelper.OfKind(dashboards, request.Kind)
            .Select(d => new DashboardMinimalResponse { DashboardId = d.DashboardId, DashboardName = d.DashboardName })
            .ToList();
        return Result<IReadOnlyList<DashboardMinimalResponse>>.Success(list);
    }
}

public sealed class GetSharedWithMeDashboardsHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<GetSharedWithMeDashboardsHandler> logger) : IRequestHandler<GetSharedWithMeDashboardsQuery, Result<IReadOnlyList<DashboardCategoryResponse>>>
{
    public async Task<Result<IReadOnlyList<DashboardCategoryResponse>>> Handle(GetSharedWithMeDashboardsQuery request, CancellationToken ct)
    {
        if (!DashboardKind.IsKnown(request.Kind))
            return Result<IReadOnlyList<DashboardCategoryResponse>>.ValidationError(DashboardKind.UnknownKindMessage);

        if (!long.TryParse(currentUser.UserId, out var userId))
            return Result<IReadOnlyList<DashboardCategoryResponse>>.Success([]);

        logger.LogInformation("Fetching dashboards shared with user {UserId}.", userId);
        var categories = await repo.GetDashboardCategoriesAsync(ct);
        var allDashboards = await repo.GetAllDashboardsForShareLookupAsync(ct);
        var shared = allDashboards
            // Exclude archived/superseded Published versions — only the current version of a
            // series should appear, otherwise the same shared board looks duplicated.
            .Where(d => d.Status != DashboardStatus.Published || d.IsLatestVersion)
            .Where(d => IsSharedWith(d.ConfigJson, userId))
            .Where(d => DashboardKind.Matches(d.ConfigJson, request.Kind))
            .ToList();

        return Result<IReadOnlyList<DashboardCategoryResponse>>.Success(
            DashboardGroupingHelper.GroupByCategory(categories, shared));
    }

    private static bool IsSharedWith(string? configJson, long userId)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return false;
        try
        {
            var metadata = System.Text.Json.Nodes.JsonNode.Parse(configJson)?["_meta"];
            if (metadata?["sharedRecipientId"] is not null)
                return metadata["sharedRecipientId"]!.GetValue<long>() == userId;
            return metadata?["independentShares"]?.GetValue<bool>() != true
                && DashboardShareLink.GetSharedUserIds(configJson).Contains(userId);
        }
        catch { return false; }
    }
}

public sealed class GetPublishedDashboardsHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<GetPublishedDashboardsHandler> logger) : IRequestHandler<GetPublishedDashboardsQuery, Result<IReadOnlyList<DashboardCategoryResponse>>>
{
    public async Task<Result<IReadOnlyList<DashboardCategoryResponse>>> Handle(GetPublishedDashboardsQuery request, CancellationToken ct)
    {
        if (!DashboardKind.IsKnown(request.Kind))
            return Result<IReadOnlyList<DashboardCategoryResponse>>.ValidationError(DashboardKind.UnknownKindMessage);

        logger.LogInformation("Fetching Published dashboards.");
        var categories = await repo.GetDashboardCategoriesAsync(ct);

        // Admins see Published (latest version only) + Inactive; non-admins see only Published
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        var dashboards = await repo.GetPublishedListAsync(isAdmin, ct);
        return Result<IReadOnlyList<DashboardCategoryResponse>>.Success(
            DashboardGroupingHelper.GroupByCategory(categories, DashboardGroupingHelper.OfKind(dashboards, request.Kind)));
    }
}

// ─── Get Single Dashboard ────────────────────────────────────────────────────

public sealed class GetDashboardByIdHandler(
    IDashboardRepository repo,
    ILogger<GetDashboardByIdHandler> logger) : IRequestHandler<GetDashboardByIdQuery, Result<DashboardDetailResponse>>
{
    public async Task<Result<DashboardDetailResponse>> Handle(GetDashboardByIdQuery query, CancellationToken ct)
    {
        logger.LogInformation("Fetching dashboard. DashboardId={DashboardId}", query.DashboardId);

        var dashboard = await repo.GetDashboardDetailByIdAsync(query.DashboardId, ct);
        if (dashboard is null)
            return Result<DashboardDetailResponse>.NotFound($"Dashboard with ID {query.DashboardId} not found.");

        var response = new DashboardDetailResponse
        {
            DashboardId = dashboard.DashboardId,
            DashboardName = dashboard.DashboardName,
            CategoryId = dashboard.CategoryId,
            CategoryName = dashboard.Category?.CategoryName ?? string.Empty,
            Status = dashboard.Status,
            Description = dashboard.Description,
            ConfigJson = dashboard.ConfigJson,
            IsActive = dashboard.IsActive,
            VersionNo = dashboard.VersionNo,
            IsLatestVersion = dashboard.IsLatestVersion,
        };

        return Result<DashboardDetailResponse>.Success(response);
    }
}

public sealed class GetSharedDashboardHandler(
    IDashboardRepository repo,
    ILogger<GetSharedDashboardHandler> logger) : IRequestHandler<GetSharedDashboardQuery, Result<DashboardDetailResponse>>
{
    public async Task<Result<DashboardDetailResponse>> Handle(GetSharedDashboardQuery query, CancellationToken ct)
    {
        var dashboard = await repo.GetDashboardDetailByIdAsync(query.DashboardId, ct);
        if (dashboard is null || !DashboardShareLink.HasToken(dashboard.ConfigJson, query.Token))
            return Result<DashboardDetailResponse>.NotFound("The shared dashboard was not found or is no longer available.");

        logger.LogInformation("Fetching shared dashboard. DashboardId={DashboardId}", query.DashboardId);
        return Result<DashboardDetailResponse>.Success(new DashboardDetailResponse
        {
            DashboardId = dashboard.DashboardId,
            DashboardName = dashboard.DashboardName,
            CategoryId = dashboard.CategoryId,
            CategoryName = dashboard.Category?.CategoryName ?? string.Empty,
            Status = dashboard.Status,
            Description = dashboard.Description,
            ConfigJson = dashboard.ConfigJson,
            IsActive = dashboard.IsActive,
            VersionNo = dashboard.VersionNo,
            IsLatestVersion = dashboard.IsLatestVersion
        });
    }
}

public static class DashboardWidgetLookup
{
    public static IReadOnlyList<long> GetWidgetIds(string? configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return [];
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(configJson);
            if (!document.RootElement.TryGetProperty("widgets", out var widgets) || widgets.ValueKind != System.Text.Json.JsonValueKind.Array)
                return [];
            return widgets.EnumerateArray()
                .Where(widget => widget.TryGetProperty("chartId", out var id) && id.TryGetInt64(out _))
                .Select(widget => widget.GetProperty("chartId").GetInt64())
                .Distinct()
                .ToList();
        }
        catch { return []; }
    }

    public static async Task<WidgetLibraryResponse> ResolveAsync(IWidgetService widgetService, string? configJson, long ownerId, CancellationToken ct)
    {
        var widgets = new List<WidgetLibraryItem>();
        foreach (var widgetId in GetWidgetIds(configJson))
        {
            var widget = await widgetService.GetByIdAsync(widgetId, ownerId, ct);
            if (widget is null) continue;
            widgets.Add(new WidgetLibraryItem
            {
                Id = widget.Id,
                Name = widget.Name,
                Description = widget.Description,
                Type = widget.Type,
                LibraryId = widget.LibraryId,
                Source = widget.Source,
                SourceType = widget.SourceType,
                DesignJson = widget.DesignJson,
                Status = widget.Status,
                CategoryId = widget.CategoryId,
                CategoryName = widget.CategoryName
            });
        }

        return new WidgetLibraryResponse
        {
            Tiles = widgets.Where(widget => widget.Type.Equals("tile", StringComparison.OrdinalIgnoreCase)).ToList(),
            Charts = widgets.Where(widget => widget.Type.Equals("chart", StringComparison.OrdinalIgnoreCase)).ToList()
        };
    }
}

public sealed class GetSharedDashboardWidgetsHandler(
    IDashboardRepository dashboardRepo,
    IWidgetService widgetService) : IRequestHandler<GetSharedDashboardWidgetsQuery, Result<WidgetLibraryResponse>>
{
    public async Task<Result<WidgetLibraryResponse>> Handle(GetSharedDashboardWidgetsQuery query, CancellationToken ct)
    {
        var dashboard = await dashboardRepo.GetDashboardByIdAsync(query.DashboardId, ct);
        if (dashboard is null || !DashboardShareLink.HasToken(dashboard.ConfigJson, query.Token))
            return Result<WidgetLibraryResponse>.NotFound("The shared dashboard was not found or is no longer available.");

        if (!long.TryParse(dashboard.CreatedBy, out var ownerId)) ownerId = 0;
        var response = await DashboardWidgetLookup.ResolveAsync(widgetService, dashboard.ConfigJson, ownerId, ct);
        return Result<WidgetLibraryResponse>.Success(response);
    }
}

public sealed class GetDashboardWidgetsHandler(
    IDashboardRepository dashboardRepo,
    IWidgetService widgetService) : IRequestHandler<GetDashboardWidgetsQuery, Result<WidgetLibraryResponse>>
{
    public async Task<Result<WidgetLibraryResponse>> Handle(GetDashboardWidgetsQuery query, CancellationToken ct)
    {
        var dashboard = await dashboardRepo.GetDashboardByIdAsync(query.DashboardId, ct);
        if (dashboard is null)
            return Result<WidgetLibraryResponse>.NotFound($"Dashboard with ID {query.DashboardId} not found.");

        if (!long.TryParse(dashboard.CreatedBy, out var ownerId)) ownerId = 0;
        var response = await DashboardWidgetLookup.ResolveAsync(widgetService, dashboard.ConfigJson, ownerId, ct);
        return Result<WidgetLibraryResponse>.Success(response);
    }
}

public sealed class GetDashboardVersionHistoryHandler(
    IDashboardRepository repo,
    ILogger<GetDashboardVersionHistoryHandler> logger) : IRequestHandler<GetDashboardVersionHistoryQuery, Result<IReadOnlyList<DashboardVersionSummaryResponse>>>
{
    public async Task<Result<IReadOnlyList<DashboardVersionSummaryResponse>>> Handle(GetDashboardVersionHistoryQuery query, CancellationToken ct)
    {
        var dashboard = await repo.GetDashboardByIdAsync(query.DashboardId, ct);
        if (dashboard is null)
            return Result<IReadOnlyList<DashboardVersionSummaryResponse>>.NotFound($"Dashboard with ID {query.DashboardId} not found.");

        logger.LogInformation("Fetching version history. SeriesId={SeriesId}", dashboard.DashboardSeriesId);

        var versions = await repo.GetVersionHistoryAsync(dashboard.DashboardSeriesId, ct);
        var response = versions.Select(v => new DashboardVersionSummaryResponse
        {
            DashboardId = v.DashboardId,
            VersionNo = v.VersionNo ?? 0,
            Status = v.Status,
            IsLatestVersion = v.IsLatestVersion,
            PublishedBy = v.PublishedBy,
            ModifiedDate = v.ModifiedAt,
        }).ToList();

        return Result<IReadOnlyList<DashboardVersionSummaryResponse>>.Success(response);
    }
}

// ─── Widget Library for Dashboard Builder ────────────────────────────────────

public sealed class GetWidgetLibraryHandler(
    IWidgetService widgetService,
    ICurrentUserService currentUser,
    ILogger<GetWidgetLibraryHandler> logger) : IRequestHandler<GetWidgetLibraryQuery, Result<WidgetLibraryResponse>>
{
    public async Task<Result<WidgetLibraryResponse>> Handle(GetWidgetLibraryQuery request, CancellationToken ct)
    {
        logger.LogInformation("Fetching widget library for dashboard builder.");

        var userIdStr = currentUser.UserId ?? "0";
        if (!long.TryParse(userIdStr, out var userId))
            userId = 0;

        // Published widgets → Standard Tiles / Standard Charts (visible to everyone)
        var published = await widgetService.GetAllAsync("published", null, userId, isAdmin: false, ct);

        // Current user's drafts → My Tiles / My Charts
        var drafts = userId > 0
            ? await widgetService.GetAllAsync("draft", null, userId, isAdmin: true, ct)
            : Array.Empty<Domain.DTOs.WidgetDto>();

        // DistinctBy keeps the first occurrence — published wins over drafts when IDs overlap.
        var all = published
            .Concat(drafts)
            .DistinctBy(w => w.Id)
            .Select(w => new WidgetLibraryItem
            {
                Id = w.Id,
                Name = w.Name,
                Description = w.Description,
                Type = w.Type,
                LibraryId = w.LibraryId,
                Source = w.Source,
                SourceType = w.SourceType,
                DesignJson = w.DesignJson,
                Status = w.Status,
                CategoryId = w.CategoryId,
                CategoryName = w.CategoryName
            })
            .ToList();

        var response = new WidgetLibraryResponse
        {
            Tiles = all.Where(w => w.Type.Equals("tile", StringComparison.OrdinalIgnoreCase)).ToList(),
            Charts = all.Where(w => w.Type.Equals("chart", StringComparison.OrdinalIgnoreCase)).ToList()
        };

        return Result<WidgetLibraryResponse>.Success(response);
    }
}
