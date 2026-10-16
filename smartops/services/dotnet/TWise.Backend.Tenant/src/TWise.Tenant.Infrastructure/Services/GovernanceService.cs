using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Data dictionary over imported datasets and database views, and a lineage graph derived
/// from the pointers that already exist between sources, datasets, charts, dashboards and
/// reports. Nothing here is stored except the dictionary entries themselves.
/// </summary>
public sealed class GovernanceService(TenantDbContext db) : IGovernanceService
{
    private static readonly string[] Sensitivities = ["public", "internal", "confidential", "pii"];
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    // ── Dictionary ───────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<DictionaryDatasetDto>> ListDatasetsAsync(long tenantId, CancellationToken ct = default)
    {
        var entries = await db.DataDictionary.Where(e => e.TenantId == tenantId).ToListAsync(ct);
        var byDataset = entries.ToLookup(e => (e.DatasetKind, e.DatasetId));

        var result = new List<DictionaryDatasetDto>();
        foreach (var (kind, id, name, columns) in await LoadDatasetsAsync(tenantId, ct))
        {
            var docs = byDataset[(kind, id)].ToList();
            var dataset = docs.FirstOrDefault(d => d.ColumnName is null);
            var columnDocs = docs.Where(d => d.ColumnName is not null).ToList();
            result.Add(new DictionaryDatasetDto(kind, id, name, dataset?.Description, dataset?.Owner,
                columns.Count,
                columnDocs.Count(d => !string.IsNullOrWhiteSpace(d.Description)),
                columnDocs.Count(d => d.Sensitivity == "pii")));
        }
        return result;
    }

    public async Task<DictionaryDatasetDetailDto?> GetDatasetAsync(string kind, long id, long tenantId, CancellationToken ct = default)
    {
        var dataset = await LoadDatasetAsync(kind, id, tenantId, ct);
        if (dataset is null) return null;

        var entries = await db.DataDictionary
            .Where(e => e.TenantId == tenantId && e.DatasetKind == kind && e.DatasetId == id)
            .ToListAsync(ct);
        return ToDetail(dataset.Value, entries);
    }

    public async Task<DictionaryDatasetDetailDto?> SaveDatasetAsync(
        string kind, long id, SaveDictionaryRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        var dataset = await LoadDatasetAsync(kind, id, tenantId, ct);
        if (dataset is null) return null;

        var known = dataset.Value.Columns.Select(c => c.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var entries = await db.DataDictionary
            .Where(e => e.TenantId == tenantId && e.DatasetKind == kind && e.DatasetId == id)
            .ToListAsync(ct);
        var now = DateTime.UtcNow;

        Upsert(null, request.Description, request.Owner, null, null, null);
        foreach (var column in request.Columns.Where(c => known.Contains(c.ColumnName)))
            Upsert(column.ColumnName, column.Description, column.Owner, column.BusinessName, column.Sensitivity, column.Tags);

        await db.SaveChangesAsync(ct);
        return ToDetail(dataset.Value, entries);

        void Upsert(string? columnName, string? description, string? owner, string? businessName, string? sensitivity, string? tags)
        {
            var entry = entries.FirstOrDefault(e => string.Equals(e.ColumnName, columnName, StringComparison.OrdinalIgnoreCase));
            if (entry is null)
            {
                entry = new DataDictionaryEntry
                {
                    DatasetKind = kind, DatasetId = id, ColumnName = columnName,
                    TenantId = tenantId, CreatedBy = userId, CreatedAt = now
                };
                db.DataDictionary.Add(entry);
                entries.Add(entry);
            }
            entry.Description = Trim(description);
            entry.Owner = Trim(owner);
            entry.BusinessName = Trim(businessName);
            entry.Tags = Trim(tags);
            entry.Sensitivity = Sensitivities.Contains(sensitivity ?? "") ? sensitivity! : "internal";
            entry.ModifiedBy = userId;
            entry.ModifiedAt = now;
        }
    }

    private static string? Trim(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static DictionaryDatasetDetailDto ToDetail(
        (string Kind, long Id, string Name, List<ImportColumnDto> Columns) dataset, List<DataDictionaryEntry> entries)
    {
        var top = entries.FirstOrDefault(e => e.ColumnName is null);
        var columns = dataset.Columns.Select(c =>
        {
            var e = entries.FirstOrDefault(x => string.Equals(x.ColumnName, c.Name, StringComparison.OrdinalIgnoreCase));
            return new DictionaryColumnDto(c.Name, c.Type, e?.BusinessName, e?.Description, e?.Owner, e?.Sensitivity ?? "internal", e?.Tags);
        }).ToList();
        return new DictionaryDatasetDetailDto(dataset.Kind, dataset.Id, dataset.Name, top?.Description, top?.Owner, columns);
    }

    private async Task<(string Kind, long Id, string Name, List<ImportColumnDto> Columns)?> LoadDatasetAsync(
        string kind, long id, long tenantId, CancellationToken ct)
    {
        switch (kind)
        {
            case "import":
                var import = await db.ImportedDatasets.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId, ct);
                return import is null ? null : ("import", import.Id, import.DatasetName, ImportColumns(import.ColumnsJson));
            case "view":
                var view = await db.DatabaseViews.Where(v => v.Id == id && v.TenantId == tenantId)
                    .Select(v => new ViewShape(v.Id, v.ViewName, v.PreviewColumnsJson, v.SelectedColumnsJson, v.ColumnAliasesJson))
                    .FirstOrDefaultAsync(ct);
                return view is null ? null : ("view", view.Id, view.Name, ViewColumns(view));
            default:
                return null;
        }
    }

    private async Task<List<(string Kind, long Id, string Name, List<ImportColumnDto> Columns)>> LoadDatasetsAsync(long tenantId, CancellationToken ct)
    {
        var imports = await db.ImportedDatasets.Where(d => d.TenantId == tenantId && d.Status == "completed")
            .OrderBy(d => d.DatasetName).ToListAsync(ct);
        // Projected: DatabaseViews carries the last preview's rows (hundreds of MB across a tenant).
        var views = await db.DatabaseViews.Where(v => v.TenantId == tenantId && v.ViewType == "view")
            .OrderBy(v => v.ViewName)
            .Select(v => new ViewShape(v.Id, v.ViewName, v.PreviewColumnsJson, v.SelectedColumnsJson, v.ColumnAliasesJson))
            .ToListAsync(ct);

        var list = imports.Select(i => ("import", i.Id, i.DatasetName, ImportColumns(i.ColumnsJson))).ToList();
        list.AddRange(views.Select(v => ("view", v.Id, v.Name, ViewColumns(v))));
        return list;
    }

    private static List<ImportColumnDto> ImportColumns(string json)
    {
        try { return JsonSerializer.Deserialize<List<ImportColumnDto>>(json, Json) ?? []; }
        catch { return []; }
    }

    /// <summary>Preview columns are the view's real output; fall back to the selected columns with their aliases.</summary>
    private sealed record ViewShape(long Id, string Name, string? PreviewColumnsJson, string SelectedColumnsJson, string? ColumnAliasesJson);

    private static List<ImportColumnDto> ViewColumns(ViewShape view)
    {
        var names = ParseStrings(view.PreviewColumnsJson);
        if (names.Count == 0)
        {
            var aliases = ParseMap(view.ColumnAliasesJson);
            names = ParseStrings(view.SelectedColumnsJson)
                .Select(c => aliases.TryGetValue(c, out var alias) && alias.Length > 0 ? alias : c[(c.LastIndexOf('.') + 1)..])
                .ToList();
        }
        return names.Distinct(StringComparer.OrdinalIgnoreCase).Select(n => new ImportColumnDto(n, "")).ToList();
    }

    private static List<string> ParseStrings(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? []; }
        catch { return []; }
    }

    private static Dictionary<string, string> ParseMap(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? []; }
        catch { return []; }
    }

    // ── Lineage ──────────────────────────────────────────────────────────────

    public async Task<LineageGraphDto> GetLineageAsync(long tenantId, CancellationToken ct = default)
    {
        var nodes = new Dictionary<string, LineageNodeDto>();
        var edges = new HashSet<(string, string)>();

        void Node(string id, string kind, string label, string? sub = null) => nodes.TryAdd(id, new LineageNodeDto(id, kind, label, sub));
        void Edge(string from, string to) { if (nodes.ContainsKey(from) && nodes.ContainsKey(to)) edges.Add((from, to)); }

        foreach (var s in await db.DataSourceConnections.Where(s => s.TenantId == tenantId && !s.IsDeleted).ToListAsync(ct))
            Node($"source:{s.Id}", "source", s.ConnectionName, s.Kind);
        foreach (var c in await db.DatabaseConnections.Where(c => c.TenantId == tenantId).ToListAsync(ct))
            Node($"db:{c.Id}", "db", c.ConnectionName, $"{c.Provider} · {c.DatabaseName}");

        var imports = await db.ImportedDatasets.Where(d => d.TenantId == tenantId)
            .Select(d => new { d.Id, d.DatasetName, d.FileType, d.RowCount, d.DataSourceConnectionId })
            .ToListAsync(ct);
        foreach (var d in imports) Node($"import:{d.Id}", "import", d.DatasetName, $"{d.FileType} · {d.RowCount} rows");

        var views = await db.DatabaseViews.Where(v => v.TenantId == tenantId)
            .Select(v => new { v.Id, v.ViewName, v.ViewType, v.ConnectionId, v.ReferencedCteIdsJson, v.ReferencedComponentIdsJson })
            .ToListAsync(ct);
        foreach (var v in views) Node($"view:{v.Id}", "view", v.ViewName, v.ViewType == "view" ? null : v.ViewType);

        var widgets = await db.Widgets.Where(w => w.TenantId == tenantId)
            .Select(w => new { w.Id, w.Name, w.Type, w.Source, w.SourceType, w.SourceId, w.DesignJson })
            .ToListAsync(ct);
        foreach (var w in widgets)
        {
            Node($"chart:{w.Id}", "chart", w.Name, w.Type);
            if (w.SourceType == "Table" && !string.IsNullOrWhiteSpace(w.Source)) Node($"table:{w.Source}", "table", w.Source);
        }

        var reports = await db.Reports.Where(r => r.TenantId == tenantId)
            .Select(r => new { r.Id, r.ReportName, r.SourceType, r.SourceName })
            .ToListAsync(ct);
        foreach (var r in reports)
        {
            Node($"report:{r.Id}", "report", r.ReportName);
            if (r.SourceType == "Table" && !string.IsNullOrWhiteSpace(r.SourceName)) Node($"table:{r.SourceName}", "table", r.SourceName);
        }

        // Latest published version, plus drafts that have never been published.
        var dashboards = await db.Dashboards
            .Where(d => !d.IsDeleted && d.Status != DashboardStatus.Deleted && (d.IsLatestVersion || d.VersionNo == null))
            .Select(d => new { d.DashboardId, d.DashboardName, d.Status, d.ConfigJson })
            .ToListAsync(ct);
        foreach (var d in dashboards) Node($"dashboard:{d.DashboardId}", "dashboard", d.DashboardName, d.Status);

        foreach (var d in imports.Where(d => d.DataSourceConnectionId is not null))
            Edge($"source:{d.DataSourceConnectionId}", $"import:{d.Id}");

        foreach (var v in views)
        {
            Edge($"db:{v.ConnectionId}", $"view:{v.Id}");
            foreach (var refId in ParseIds(v.ReferencedCteIdsJson).Concat(ParseIds(v.ReferencedComponentIdsJson)))
                Edge($"view:{refId}", $"view:{v.Id}");
        }

        foreach (var w in widgets)
        {
            var chart = $"chart:{w.Id}";
            switch (w.SourceType)
            {
                case "Import": Edge($"import:{w.SourceId ?? ParseId(w.Source)}", chart); break;
                case "View": Edge($"view:{w.SourceId ?? ParseId(w.Source)}", chart); break;
                case "Table": Edge($"table:{w.Source}", chart); break;
            }
            var design = ParseObject(w.DesignJson);
            if (design is not null)
            {
                if (design.Value.TryGetProperty("drillDownViewId", out var drill) && drill.TryGetInt64(out var drillId))
                    Edge($"view:{drillId}", chart);
                if (design.Value.TryGetProperty("attachedTileIds", out var tiles) && tiles.ValueKind == JsonValueKind.Array)
                    foreach (var tile in tiles.EnumerateArray())
                        if (tile.TryGetInt64(out var tileId)) Edge($"chart:{tileId}", chart);
            }
        }

        foreach (var r in reports)
        {
            var report = $"report:{r.Id}";
            if (r.SourceType == "View")
            {
                var view = views.FirstOrDefault(v => v.ViewName == r.SourceName);
                if (view is not null) Edge($"view:{view.Id}", report);
            }
            else Edge($"table:{r.SourceName}", report);
        }

        foreach (var d in dashboards)
            foreach (var widgetId in DashboardWidgetLookup.GetWidgetIds(d.ConfigJson))
                Edge($"chart:{widgetId}", $"dashboard:{d.DashboardId}");

        return new LineageGraphDto(nodes.Values.ToList(), edges.Select(e => new LineageEdgeDto(e.Item1, e.Item2)).ToList());
    }

    private static long ParseId(string source) => long.TryParse(source, out var id) ? id : 0;

    private static IEnumerable<long> ParseIds(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<long>>(json) ?? []; }
        catch { return []; }
    }

    private static JsonElement? ParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var element = JsonSerializer.Deserialize<JsonElement>(json);
            return element.ValueKind == JsonValueKind.Object ? element : null;
        }
        catch { return null; }
    }
}
