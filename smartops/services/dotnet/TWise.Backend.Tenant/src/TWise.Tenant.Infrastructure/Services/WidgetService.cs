using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using System.Text.Json.Nodes;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class WidgetService(IWidgetRepository repo) : IWidgetService
{
    private const string CopyMetaKey = "_meta";
    private const string CopiedFromWidgetIdKey = "copiedFromWidgetId";

    public async Task<IReadOnlyList<WidgetDto>> GetAllAsync(
        string? status, string? type, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var widgets = await repo.GetAllAsync(status, type, userId, isAdmin, ct);
        return widgets.Select(ToDto).ToList();
    }

    public async Task<WidgetDto?> GetByIdAsync(long id, long userId, CancellationToken ct = default)
    {
        var widget = await repo.GetAccessibleByIdAsync(id, userId, ct);
        if (widget is null) return null;
        var tileIds = AttachedTileIds(widget.DesignJson);
        if (tileIds.Count == 0) return ToDto(widget);
        // One query for every attached tile, returned in the saved order (DFCT0010620 follow-up:
        // the chart view used to fetch each tile with its own request).
        var tiles = await repo.GetByIdsAsync(tileIds, ct);
        var ordered = tileIds.Select(tileId => tiles.FirstOrDefault(t => t.Id == tileId))
            .Where(t => t is not null).Select(t => ToDto(t!)).ToList();
        return ToDto(widget) with { AttachedTiles = ordered };
    }

    private static List<long> AttachedTileIds(string? designJson)
    {
        if (string.IsNullOrWhiteSpace(designJson)) return [];
        try
        {
            return JsonNode.Parse(designJson)?["attachedTileIds"] is JsonArray ids
                ? ids.Select(n => n?.GetValue<long>() ?? 0).Where(v => v > 0).Distinct().ToList()
                : [];
        }
        catch (Exception) { return []; }
    }

    public async Task<WidgetDto> CreateAsync(
        CreateWidgetRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        // Prevent duplicate names per user+type
        if (await repo.IsDuplicateNameAsync(request.Name, request.Type, userId, excludeId: null, ct))
            throw new InvalidOperationException(
                $"A {request.Type} named '{request.Name}' already exists. Choose a different name.");

        var widget = new Widget
        {
            Name        = request.Name,
            Description = request.Description,
            Type        = request.Type,
            LibraryId  = request.LibraryId,
            Source     = request.Source,
            SourceType = request.SourceType,
            SourceId   = request.SourceType is "View" or "Import" ? request.SourceId : null,
            DesignJson = request.DesignJson,
            Status     = "draft",
            CategoryId = request.CategoryId,
            TenantId   = tenantId,
            CreatedBy  = userId,
            CreatedAt  = DateTime.UtcNow,
            ModifiedOn = DateTime.UtcNow,
            IsDeleted  = false
        };
        var saved = await repo.CreateAndLoadCategoryAsync(widget, ct);
        return ToDto(saved);
    }

    public async Task<WidgetDto?> CopyToDraftAsync(
        long id, long userId, bool isAdmin, long tenantId, CancellationToken ct = default)
    {
        if (!isAdmin) throw new UnauthorizedAccessException("Only administrators can copy published widgets.");

        var source = await repo.GetAccessibleByIdAsync(id, userId, ct);
        if (source is null || source.Status != "published") return null;

        var copyName = source.Name + " copy";
        var suffix = 2;
        while (await repo.IsDuplicateNameAsync(copyName, source.Type, userId, excludeId: null, ct))
            copyName = source.Name + " copy " + suffix++;

        var copy = new Widget
        {
            Name = copyName,
            Description = source.Description,
            Type = source.Type,
            LibraryId = source.LibraryId,
            Source = source.Source,
            SourceType = source.SourceType,
            SourceId = source.SourceId,
            DesignJson = WithCopiedFrom(source.DesignJson, source.Id),
            Status = "draft",
            CategoryId = source.CategoryId,
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            ModifiedOn = DateTime.UtcNow,
            IsDeleted = false,
        };

        return ToDto(await repo.CreateAndLoadCategoryAsync(copy, ct));
    }

    public async Task<WidgetDto?> UpdateAsync(
        long id, UpdateWidgetRequest request, long userId, bool isAdmin, CancellationToken ct = default)
    {
        var widget = await repo.GetAccessibleByIdAsync(id, userId, ct);
        if (widget is null) return null;

        if (!isAdmin && widget.CreatedBy != userId)
            throw new UnauthorizedAccessException("Only the widget owner or an administrator can update this widget.");

        // Prevent renaming to a name already used by another widget of the same type
        if (await repo.IsDuplicateNameAsync(request.Name, request.Type, userId, excludeId: id, ct))
            throw new InvalidOperationException(
                $"A {request.Type} named '{request.Name}' already exists. Choose a different name.");

        // Only admin can publish
        if (request.Status == "published" && !isAdmin)
            throw new UnauthorizedAccessException("Only administrators can publish widgets.");

        // Only draft charts/tiles can transition to completed
        if (request.Status == "completed")
        {
            var allowedTypes = new[] { "chart", "tile" };
            if (!allowedTypes.Contains(widget.Type, StringComparer.OrdinalIgnoreCase)
                || !allowedTypes.Contains(request.Type, StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException("Only charts and tiles can be marked as completed.");
            if (widget.Status != "draft")
                throw new InvalidOperationException("Only widgets with status 'draft' can be completed. Current status: " + widget.Status + ".");
        }

        var copiedFromId = GetCopiedFromWidgetId(widget.DesignJson);
        widget.Name        = request.Name;
        widget.Description = request.Description;
        widget.Type        = request.Type;
        widget.LibraryId  = request.LibraryId;
        widget.Source     = request.Source;
        widget.SourceType = request.SourceType;
        widget.SourceId   = request.SourceType is "View" or "Import" ? request.SourceId : null;
        widget.DesignJson = copiedFromId is long sourceId
            ? WithCopiedFrom(request.DesignJson, sourceId)
            : request.DesignJson;
        if (request.Status is not null)
            widget.Status = request.Status;
        widget.CategoryId = request.CategoryId;
        widget.ModifiedBy = userId;
        widget.ModifiedOn = DateTime.UtcNow;

        if (request.Status == "published" && GetCopiedFromWidgetId(widget.DesignJson) is long publishSourceId)
        {
            var source = await repo.GetAccessibleByIdAsync(publishSourceId, userId, ct);
            if (source is null || source.Status != "published") return null;

            source.Description = widget.Description;
            source.Type = widget.Type;
            source.LibraryId = widget.LibraryId;
            source.Source = widget.Source;
            source.SourceType = widget.SourceType;
            source.SourceId = widget.SourceId;
            source.DesignJson = WithoutCopyMeta(widget.DesignJson);
            source.CategoryId = widget.CategoryId;
            source.ModifiedBy = userId;
            source.ModifiedOn = DateTime.UtcNow;

            widget.Status = "inactive";
            widget.IsDeleted = true;
            widget.ModifiedBy = userId;
            widget.ModifiedOn = DateTime.UtcNow;

            var merged = await repo.PublishCopyToSourceAsync(source, widget, ct);
            return ToDto(merged);
        }

        var saved = await repo.SaveAndLoadCategoryAsync(widget, ct);
        return ToDto(saved);
    }

    private static string? WithCopiedFrom(string? designJson, long sourceId)
    {
        JsonObject root;
        try { root = JsonNode.Parse(designJson ?? "{}") as JsonObject ?? new JsonObject(); }
        catch { root = new JsonObject(); }
        root[CopyMetaKey] = new JsonObject { [CopiedFromWidgetIdKey] = sourceId };
        return root.ToJsonString();
    }

    private static long? GetCopiedFromWidgetId(string? designJson)
    {
        try
        {
            if (JsonNode.Parse(designJson ?? "") is JsonObject root &&
                root[CopyMetaKey] is JsonObject meta &&
                meta[CopiedFromWidgetIdKey] is JsonNode idNode &&
                idNode.AsValue().TryGetValue<long>(out var id)) return id;
        }
        catch { }
        return null;
    }

    private static string? WithoutCopyMeta(string? designJson)
    {
        try
        {
            if (JsonNode.Parse(designJson ?? "") is not JsonObject root) return designJson;
            root.Remove(CopyMetaKey);
            return root.ToJsonString();
        }
        catch { return designJson; }
    }

    public Task<bool> DeleteAsync(long id, long userId, CancellationToken ct = default)
        => repo.SoftDeleteAsync(id, userId, ct);

    private static WidgetDto ToDto(Widget w) => new(
        w.Id, w.Name, w.Description, w.Type, w.LibraryId, w.Source, w.SourceType, w.SourceId, w.DesignJson, w.Status,
        w.CategoryId, w.Category?.CategoryName,
        w.TenantId, w.CreatedBy, w.CreatedAt, w.ModifiedBy, w.ModifiedOn);
}
