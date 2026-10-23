using MediatR;
using Microsoft.Extensions.Logging;
using System.Text.Json.Nodes;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Dashboards;

// ─── Update Dashboard Handler ────────────────────────────────────────────────

public sealed class UpdateDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<UpdateDashboardHandler> logger,
    ICategoryRepository categories,
    IWidgetService widgets) : IRequestHandler<UpdateDashboardCommand, Result<UpdateDashboardResponse>>
{
    public async Task<Result<UpdateDashboardResponse>> Handle(UpdateDashboardCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Updating dashboard. DashboardId={DashboardId}", cmd.DashboardId);

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<UpdateDashboardResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        // Ownership check: only the creator or an admin can edit
        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        var isOwner = string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase);
        var isSharedRecipient = !isOwner && long.TryParse(userId, out var recipientId)
            && DashboardShareLink.GetSharedUserIds(dashboard.ConfigJson).Contains(recipientId);
        if (isSharedRecipient)
            return await DashboardSharedCopy.CreateAsync(repo, categories, widgets, dashboard, cmd.Request, userId, ct);
        if (!isAdmin && !isOwner)
            return Result<UpdateDashboardResponse>.Forbidden("You can only edit dashboards you created.");

        if (dashboard.Status != DashboardStatus.Draft && dashboard.Status != DashboardStatus.Completed)
            return Result<UpdateDashboardResponse>.ValidationError($"Only Draft or Completed dashboards can be edited. Current status: {dashboard.Status}.");

        var request = cmd.Request;

        var kindRefusal = DashboardKind.ChangeRefusal(dashboard.ConfigJson, request.ConfigJson);
        if (kindRefusal is not null)
            return Result<UpdateDashboardResponse>.ValidationError(kindRefusal);

        // Category must exist
        var categoryExists = await repo.CategoryExistsAsync(request.CategoryId, ct);
        if (!categoryExists)
            return Result<UpdateDashboardResponse>.ValidationError("Category does not exist.");

        // Duplicate check (if name or category changed)
        if (request.DashboardName.Trim() != dashboard.DashboardName || request.CategoryId != dashboard.CategoryId)
        {
            var exists = await repo.DashboardExistsAsync(request.DashboardName.Trim(), request.CategoryId, ct);
            if (exists)
                return Result<UpdateDashboardResponse>.Conflict("Dashboard with same name already exists in this category.");
        }

        // Update fields
        dashboard.DashboardName = request.DashboardName.Trim();
        dashboard.CategoryId = request.CategoryId;
        dashboard.Description = request.Description?.Trim();
        dashboard.ConfigJson = DashboardShareLink.PreserveMeta(dashboard.ConfigJson, request.ConfigJson);

        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateDashboardAsync(dashboard, ct);

        logger.LogInformation("Dashboard updated successfully. DashboardId={DashboardId}", cmd.DashboardId);

        return Result<UpdateDashboardResponse>.Success(new UpdateDashboardResponse
        {
            DashboardId = dashboard.DashboardId,
            DashboardName = dashboard.DashboardName,
            Status = dashboard.Status,
            Message = $"Dashboard '{dashboard.DashboardName}' has been updated successfully."
        });
    }

}

public static class DashboardSharedCopy
{
    public static async Task<Result<UpdateDashboardResponse>> CreateAsync(
        IDashboardRepository repo, ICategoryRepository categories, IWidgetService widgets,
        Dashboard source, SaveDashboardRequest request, string userId, CancellationToken ct,
        bool sharedAtCreation = false)
    {
        var recipientId = long.Parse(userId);
        if (!long.TryParse(source.CreatedBy, out var ownerId))
            return Result<UpdateDashboardResponse>.ValidationError("The shared dashboard owner could not be resolved.");

        var config = JsonNode.Parse(request.ConfigJson ?? "{}") as JsonObject ?? new JsonObject();
        config.Remove("_meta");
        var sourceWidgetIds = DashboardWidgetLookup.GetWidgetIds(source.ConfigJson).ToHashSet();
        var requestedWidgets = new Dictionary<long, WidgetDto>();
        var pendingIds = new Queue<long>(DashboardWidgetLookup.GetWidgetIds(config.ToJsonString()));
        while (pendingIds.TryDequeue(out var widgetId))
        {
            if (requestedWidgets.ContainsKey(widgetId)) continue;
            var widget = await widgets.GetByIdAsync(widgetId, recipientId, ct);
            if (widget is null && sourceWidgetIds.Contains(widgetId))
                widget = await widgets.GetByIdAsync(widgetId, ownerId, ct);
            if (widget is null)
                return Result<UpdateDashboardResponse>.Forbidden("A widget is not available to this shared dashboard.");
            requestedWidgets[widgetId] = widget;
            var design = JsonNode.Parse(widget.DesignJson ?? "{}") as JsonObject;
            if (design?["attachedTileIds"] is not JsonArray attachedIds) continue;
            foreach (var attachedId in attachedIds.OfType<JsonValue>())
            {
                if (!attachedId.TryGetValue<long>(out var tileId) || tileId <= 0) continue;
                if (sourceWidgetIds.Contains(widgetId)) sourceWidgetIds.Add(tileId);
                pendingIds.Enqueue(tileId);
            }
        }

        var category = (await categories.GetAllAsync("Dashboard", ct: ct))
            .FirstOrDefault(item => item.CategoryName.Equals("Shared Dashboard", StringComparison.OrdinalIgnoreCase));
        if (category is null)
        {
            category = new Category
            {
                CategoryName = "Shared Dashboard",
                ControlType = "Dashboard",
                CreatedBy = userId,
                ModifiedBy = userId
            };
            await categories.CreateAsync(category, ct);
        }

        var baseName = request.DashboardName.Trim();
        var name = baseName;
        var suffix = 2;
        while (await repo.DashboardExistsAsync(name, category.CategoryId, ct))
            name = $"{baseName} ({suffix++})";

        var copies = new Dictionary<long, long>();
        var visiting = new HashSet<long>();
        // The default listing hides inactive widgets, but the DB duplicate check still counts them.
        var existingWidgets = (await widgets.GetAllAsync(null, null, recipientId, false, ct))
            .Concat(await widgets.GetAllAsync("inactive", null, recipientId, false, ct));
        // SQL name equality ignores trailing spaces, so the key must too.
        static string NameKey(string type, string name) => $"{type}:{name.TrimEnd()}";
        var names = existingWidgets.Select(widget => NameKey(widget.Type, widget.Name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        async Task<long> CopyWidgetAsync(long widgetId)
        {
            if (copies.TryGetValue(widgetId, out var copiedId)) return copiedId;
            var widget = requestedWidgets[widgetId];
            if (!sharedAtCreation && widget.CreatedBy == recipientId) return copies[widgetId] = widgetId;
            if (!visiting.Add(widgetId)) throw new InvalidOperationException("Circular attached tile reference.");
            var design = JsonNode.Parse(widget.DesignJson ?? "{}") as JsonObject ?? new JsonObject();
            design.Remove("_meta");
            if (design["attachedTileIds"] is JsonArray attachedIds)
            {
                for (var index = 0; index < attachedIds.Count; index++)
                    if (attachedIds[index] is JsonValue value && value.TryGetValue<long>(out var tileId) && tileId > 0)
                        attachedIds[index] = await CopyWidgetAsync(tileId);
            }
            var widgetName = widget.Name;
            var number = 2;
            while (!names.Add(NameKey(widget.Type, widgetName))) widgetName = $"{widget.Name.TrimEnd()} ({number++})";
            var createdWidget = await widgets.CreateAsync(new CreateWidgetRequest(
                widgetName, widget.Description, widget.Type, widget.LibraryId, widget.Source,
                widget.SourceType, widget.SourceId, design.ToJsonString(), widget.CategoryId),
                recipientId, widget.TenantId, ct);
            visiting.Remove(widgetId);
            return copies[widgetId] = createdWidget.Id;
        }

        foreach (var widgetId in requestedWidgets.Keys) await CopyWidgetAsync(widgetId);
        if (config["widgets"] is JsonArray entries)
            foreach (var entry in entries.OfType<JsonObject>())
                if (entry["chartId"] is JsonValue value && value.TryGetValue<long>(out var widgetId)
                    && copies.TryGetValue(widgetId, out var copiedId)) entry["chartId"] = copiedId;
        if (config["layout"] is JsonObject layout && layout["items"] is JsonArray items)
            foreach (var item in items.OfType<JsonObject>())
                if (item["id"] is JsonValue value && value.TryGetValue<long>(out var widgetId)
                    && copies.TryGetValue(widgetId, out var copiedId)) item["id"] = copiedId;

        if (sharedAtCreation)
            config["_meta"] = new JsonObject
            {
                ["sharedRecipientId"] = recipientId,
                ["sharedWithUserIds"] = new JsonArray(JsonValue.Create(recipientId))
            };

        var copy = await repo.CreateDashboardAsync(new Dashboard
        {
            DashboardName = name,
            CategoryId = category.CategoryId,
            Description = request.Description?.Trim(),
            ConfigJson = config.ToJsonString(),
            Status = DashboardStatus.Draft,
            CreatedBy = userId,
            ModifiedBy = userId
        }, ct);

        return Result<UpdateDashboardResponse>.Success(new UpdateDashboardResponse
        {
            DashboardId = copy.DashboardId,
            DashboardName = copy.DashboardName,
            Status = copy.Status,
            Message = $"Dashboard '{copy.DashboardName}' has been saved in Shared Dashboard."
        });
    }
}
