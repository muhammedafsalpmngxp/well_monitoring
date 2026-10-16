using System.Globalization;
using System.Text.Json;
using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.Application.Features.Delivery;

// The shapes of a saved canvas (core.Dashboard.ConfigJson with kind canvas) that a delivery reads. They mirror
// CanvasItem, CanvasFilter and CanvasSheet in the frontend's canvas-config.util.ts and canvas-filter.util.ts.

public sealed class CanvasAggregate
{
    public string Field { get; init; } = string.Empty;
    public string Fn { get; init; } = string.Empty;
}

public sealed class CanvasFilterSecond
{
    public string Join { get; init; } = "and";
    public string? Op { get; init; }
    public string? Value { get; init; }
    public string? Value2 { get; init; }
}

public sealed class CanvasTop
{
    public string Direction { get; init; } = "top";
    public int Count { get; init; }
    public string? Measure { get; init; }
    public string? Fn { get; init; }
}

public sealed class CanvasFilter
{
    public string Field { get; init; } = string.Empty;
    public string Mode { get; init; } = "basic";
    public List<string> Values { get; init; } = [];
    public bool? Exclude { get; init; }
    public string? Op { get; init; }
    public string? Value { get; init; }
    public string? Value2 { get; init; }
    public CanvasFilterSecond? Second { get; init; }
    public CanvasTop? Top { get; init; }
}

public sealed class CanvasItem
{
    public string Id { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public string? Title { get; init; }
    public long? DatasetId { get; init; }
    public List<string> Dimensions { get; init; } = [];
    public List<string> Measures { get; init; } = [];
    public Dictionary<string, CanvasAggregate>? Aggregates { get; init; }
    public string? ChartType { get; init; }
    public string? Series { get; init; }
    public string? Target { get; init; }
    public string? Compare { get; init; }
    public string? XMeasure { get; init; }
    public string? SizeMeasure { get; init; }
    public List<string>? Tooltips { get; init; }
    public string? SortOrder { get; init; }
    public string? SortBy { get; init; }
    public bool? Totals { get; init; }
    public bool? Gauge { get; init; }
    public double? TargetValue { get; init; }
    public List<CanvasFilter>? Filters { get; init; }
}

public sealed record CanvasSheet(string Name, IReadOnlyList<CanvasItem> Items, IReadOnlyList<CanvasFilter> Filters);

/// <summary>
/// DatasetId is the canvas dataset: the saved one, or the first data object's on canvases saved before it. Names are
/// the canvas-only names of fields and measures.
/// </summary>
public sealed record CanvasLayout(
    IReadOnlyList<CanvasSheet> Sheets, long? DatasetId, IReadOnlyList<CanvasFilter> Filters, IReadOnlyDictionary<string, string> Names);

/// <summary>
/// The POST /api/query request each data object of a canvas makes, as the canvas page builds it (itemQuery and
/// sheetFilters): its fields, measures and values, and the filters on all pages, on its sheet and on itself. Slicer
/// choices and clicks are not applied, since a delivery has none, and slicers themselves are not exported.
/// </summary>
public static class CanvasQueries
{
    private const int ChartRowLimit = 50;
    private const int PointRowLimit = 500;
    private const int TableRowLimit = 200;
    private const int SeriesRowLimit = 400;
    private const int MaxSeries = 8;
    private const int MatrixRowLimit = 500;
    private const int MatrixMaxRowFields = 3;
    private const int MaxDrillLevels = 4;

    private static readonly string[] SeriesCharts = ["column", "bar", "line", "area"];
    private static readonly string[] OneMeasureCharts = ["pie", "donut", "treemap", "waterfall", "funnel"];
    private static readonly string[] InFieldOrder = ["line", "area", "combo", "waterfall"];
    private static readonly string[] DrillCharts = ["column", "bar", "line", "area", "pie", "donut", "treemap", "funnel"];
    private static readonly string[] Exported = ["chart", "tile", "table", "matrix"];

    private static readonly Dictionary<string, string> DefaultTitle = new()
    {
        ["chart"] = "New chart", ["tile"] = "New tile", ["table"] = "New table", ["matrix"] = "New matrix",
    };

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The canvas, or null when the JSON is not a version 2 canvas. Objects and filters of a broken shape are dropped.</summary>
    public static CanvasLayout? Read(string? configJson)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(configJson ?? string.Empty);
        }
        catch (Exception ex) when (ex is JsonException or ArgumentException)
        {
            return null;
        }
        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String || kind.GetString() != "canvas"
                || !root.TryGetProperty("layout", out var layout) || layout.ValueKind != JsonValueKind.Object
                || !layout.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || version.GetInt32() != 2)
                return null;

            var sheets = Array(layout, "sheets").Select((sheet, i) => new CanvasSheet(
                sheet.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString()! : $"Sheet {i + 1}",
                Array(sheet, "items").Select(Parse<CanvasItem>).OfType<CanvasItem>().ToList(),
                Filters(sheet))).ToList();
            long? datasetId = layout.TryGetProperty("datasetId", out var saved) && saved.ValueKind == JsonValueKind.Number && saved.TryGetInt64(out var id)
                ? id
                : sheets.SelectMany(s => s.Items).FirstOrDefault(item => IsData(item) && item.DatasetId is not null)?.DatasetId;
            var names = layout.TryGetProperty("fields", out var fields) && fields.ValueKind == JsonValueKind.Object
                && fields.TryGetProperty("names", out var named) && named.ValueKind == JsonValueKind.Object
                ? named.EnumerateObject().Where(p => p.Value.ValueKind == JsonValueKind.String).ToDictionary(p => p.Name, p => p.Value.GetString()!)
                : [];
            return new CanvasLayout(sheets, datasetId, Filters(layout), names);
        }

        static IEnumerable<JsonElement> Array(JsonElement parent, string name)
            => parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array
                ? list.EnumerateArray()
                : [];

        List<CanvasFilter> Filters(JsonElement parent) => Array(parent, "filters").Select(Parse<CanvasFilter>).OfType<CanvasFilter>().ToList();
    }

    /// <summary>Every exported object in sheet order, under its title, with the query it makes. Draft is off: a delivery reads the published model.</summary>
    public static IReadOnlyList<(string Title, QueryRequest Query)> Exports(CanvasLayout layout, DateOnly today)
    {
        var exports = new List<(string, QueryRequest)>();
        foreach (var sheet in layout.Sheets)
        {
            foreach (var item in sheet.Items.Where(item => Exported.Contains(item.Type)))
            {
                var foreign = item.DatasetId is not null && item.DatasetId != layout.DatasetId;
                var filters = foreign
                    ? []
                    : FiltersQuery([.. layout.Filters, .. sheet.Filters], today).Concat(FiltersQuery(item.Filters, today)).ToList();
                if (ItemQuery(item, filters) is { } query)
                    exports.Add((string.IsNullOrWhiteSpace(item.Title) ? DefaultTitle[item.Type] : item.Title.Trim(), query));
            }
        }
        return exports;
    }

    /// <summary>A result column as the canvas export heads it: its canvas name, else the column without its table alias.</summary>
    public static string Header(CanvasLayout layout, string column)
        => layout.Names.TryGetValue(column, out var name) ? name : column[(column.IndexOf('.') + 1)..];

    /// <summary>The request of a data object, or null while it is incomplete. A chart with a hierarchy is read at its top level.</summary>
    public static QueryRequest? ItemQuery(CanvasItem item, IReadOnlyList<QueryFilter> filters)
    {
        if (item.Type == "chart" && item.Dimensions.Count > 1) item = With(item, [item.Dimensions[0]]);
        if (!IsData(item) || item.DatasetId is not { } datasetId || Problem(item) is not null) return null;
        var query = new QueryRequest(datasetId, item.Dimensions, item.Measures, filters.Count > 0 ? filters : null);
        if (QueryFor(item, query) is not { } full) return null;
        var values = full.Measures.Where(name => item.Aggregates?.ContainsKey(name) == true)
            .Select(name => new FieldValue(name, item.Aggregates![name].Field, item.Aggregates[name].Fn)).ToList();
        return values.Count > 0 ? full with { Values = values } : full;
    }

    private static QueryRequest? QueryFor(CanvasItem item, QueryRequest query)
    {
        switch (item.Type)
        {
            case "tile":
                return query with { Measures = Unique([.. item.Measures, item.Target, item.Compare]) };
            case "table":
                return query with { TopN = TableRowLimit, Totals = item.Totals != false && item.Dimensions.Count > 0 && item.Measures.Count > 0 };
            case "matrix":
                return query with { TopN = MatrixRowLimit, Totals = item.Totals != false };
            case "chart":
            {
                var type = item.ChartType ?? "column";
                if (item.Series is { } series && SeriesCharts.Contains(type))
                {
                    var axisOrder = item.SortOrder?.StartsWith("axis", StringComparison.Ordinal) == true ? item.SortOrder : "axis_asc";
                    var (seriesSort, seriesExtra) = ChartSort(item, type, axisOrder);
                    List<QueryFilter> filters = [.. query.Filters ?? [], new QueryFilter(series, "top", [MaxSeries.ToString(CultureInfo.InvariantCulture), item.Measures[0]])];
                    if (!InFieldOrder.Contains(type))
                        filters.Add(new QueryFilter(item.Dimensions[0], "top", [ChartRowLimit.ToString(CultureInfo.InvariantCulture), item.Measures[0]]));
                    return query with
                    {
                        Dimensions = [item.Dimensions[0], series, .. seriesExtra], TopN = SeriesRowLimit, Sort = seriesSort, Filters = filters,
                    };
                }
                var tips = item.Tooltips ?? [];
                var (sort, extra) = ChartSort(item, type, item.SortOrder);
                var measures = type switch
                {
                    "bullet" => Unique([.. item.Measures, item.Target, .. tips]),
                    "scatter" or "bubble" => Unique([item.XMeasure, .. item.Measures, type == "bubble" ? item.SizeMeasure : null, .. tips]),
                    _ => tips.Count > 0 ? Unique([.. query.Measures, .. tips]) : query.Measures,
                };
                return query with
                {
                    Dimensions = extra.Count > 0 ? [.. query.Dimensions, .. extra] : query.Dimensions,
                    Measures = measures,
                    TopN = type is "scatter" or "bubble" ? PointRowLimit : ChartRowLimit,
                    Sort = sort,
                };
            }
            default:
                // Slicers are not exported; text and images have no query.
                return null;
        }
    }

    /// <summary>The sort a chart asks for, and the field it groups by for it (a sort-by field other than the axis).</summary>
    private static (QuerySort Sort, List<string> Extra) ChartSort(CanvasItem item, string type, string? sortOrder)
    {
        var axis = item.Dimensions[0];
        var order = sortOrder ?? (InFieldOrder.Contains(type) ? "axis_asc" : "value_desc");
        if (order is "value_desc" or "value_asc") return (new QuerySort(item.Measures[0], order == "value_desc"), []);
        var by = !string.IsNullOrEmpty(item.SortBy) && item.SortBy != axis ? item.SortBy : axis;
        return (new QuerySort(by, order == "axis_desc"), by == axis ? [] : [by]);
    }

    /// <summary>What the object still needs before it can be shown, as itemProblem says it; null when it is complete.</summary>
    private static string? Problem(CanvasItem item)
    {
        switch (item.Type)
        {
            case "tile":
                if (item.Measures.Count != 1 || item.Dimensions.Count > 0) return "Choose one measure.";
                return item.Gauge == true && item.Target is null && item.TargetValue is null ? "A gauge needs a target." : null;
            case "table":
                return item.Dimensions.Count > 0 || item.Measures.Count > 0 ? null : "Choose at least one field or measure.";
            case "matrix":
                if (item.Dimensions.Count == 0 || item.Measures.Count == 0) return "Choose Rows and Values.";
                return item.Dimensions.Count > MatrixMaxRowFields ? "Too many row fields." : null;
            case "chart":
                return ChartProblem(item);
            default:
                return null;
        }
    }

    private static string? ChartProblem(CanvasItem item)
    {
        var type = item.ChartType ?? "column";
        var drillable = DrillCharts.Contains(type) && item.Series is null;
        if (item.Dimensions.Count > 1 && drillable)
        {
            if (item.Dimensions.Count > MaxDrillLevels) return "Too many drill levels.";
        }
        else if (item.Dimensions.Count != 1) return "Choose one field to group by.";
        if (item.Measures.Count == 0) return "Choose at least one measure.";
        if (OneMeasureCharts.Contains(type) && item.Measures.Count > 1) return "Keep one measure.";
        if (type == "combo" && item.Measures.Count < 2) return "A combo chart needs two measures.";
        if (type is "scatter" or "bubble" && (item.XMeasure is null || item.Measures.Count != 1)) return "Needs an X and a Y measure.";
        if (type == "bubble" && item.SizeMeasure is null) return "Needs a size measure.";
        if (type == "bullet" && (item.Measures.Count > 1 || item.Target is null)) return "A bullet chart needs one measure and a target.";
        if (item.Series is { } series && SeriesCharts.Contains(type) && (series == item.Dimensions[0] || item.Measures.Count > 1))
            return "Legend splits one measure by another field.";
        return null;
    }

    /// <summary>Every filter of the list that filters something, as query filters (filtersQuery).</summary>
    public static IEnumerable<QueryFilter> FiltersQuery(IEnumerable<CanvasFilter>? filters, DateOnly today)
        => (filters ?? []).SelectMany(filter => FilterQuery(filter, today));

    private static IEnumerable<QueryFilter> FilterQuery(CanvasFilter filter, DateOnly today)
    {
        var field = filter.Field;
        if (filter.Mode == "basic")
            return filter.Values.Count == 0 ? [] : [new QueryFilter(field, filter.Exclude == true ? "not_in" : "in", filter.Values)];
        if (filter.Mode == "top")
        {
            var top = filter.Top;
            if (top is null || string.IsNullOrEmpty(top.Measure) || top.Count <= 0) return [];
            var count = top.Count.ToString(CultureInfo.InvariantCulture);
            return [new QueryFilter(field, top.Direction, top.Fn is null ? [count, top.Measure] : [count, top.Measure, top.Fn])];
        }
        var first = Condition(field, filter.Op, filter.Value, filter.Value2, today);
        var second = filter.Second is { } s ? Condition(field, s.Op, s.Value, s.Value2, today) : [];
        if (filter.Second?.Join == "or" && first.Count > 0 && second.Count > 0) return [new QueryFilter(field, "any", null, [.. first, .. second])];
        return [.. first, .. second];
    }

    private static List<QueryFilter> Condition(string field, string? op, string? value, string? value2, DateOnly today)
    {
        var a = value?.Trim() ?? string.Empty;
        var b = value2?.Trim() ?? string.Empty;
        switch (op)
        {
            case null:
                return [];
            case "blank":
                return [new QueryFilter(field, "is_null")];
            case "not_blank":
                return [new QueryFilter(field, "not_null")];
            case "between":
                if (a.Length > 0 && b.Length > 0) return [new QueryFilter(field, "between", [a, b])];
                if (a.Length > 0) return [new QueryFilter(field, "gte", [a])];
                return b.Length > 0 ? [new QueryFilter(field, "lte", [b])] : [];
            case "before":
                return a.Length > 0 ? [new QueryFilter(field, "lt", [a])] : [];
            case "after":
                return a.Length > 0 ? [new QueryFilter(field, "gt", [a])] : [];
            case "last_days" or "last_months" or "last_years":
                return int.TryParse(a, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n > 0
                    ? [new QueryFilter(field, "gte", [RelativeStart(op, n, today)])]
                    : [];
            default:
                return a.Length > 0 ? [new QueryFilter(field, op, [a])] : [];
        }
    }

    /// <summary>Today less n days, months or years, as 2026-01-31; 31 March less a month is the end of February.</summary>
    private static string RelativeStart(string op, int n, DateOnly today)
        => (op switch
        {
            "last_days" => today.AddDays(-n),
            "last_months" => today.AddMonths(-n),
            _ => today.AddYears(-n),
        }).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static bool IsData(CanvasItem item) => item.Type is not ("text" or "image");

    private static CanvasItem With(CanvasItem item, List<string> dimensions) => new()
    {
        Id = item.Id, Type = item.Type, Title = item.Title, DatasetId = item.DatasetId, Dimensions = dimensions, Measures = item.Measures,
        Aggregates = item.Aggregates, ChartType = item.ChartType, Series = item.Series, Target = item.Target, Compare = item.Compare,
        XMeasure = item.XMeasure, SizeMeasure = item.SizeMeasure, Tooltips = item.Tooltips, SortOrder = item.SortOrder,
        SortBy = item.SortBy, Totals = item.Totals, Gauge = item.Gauge, TargetValue = item.TargetValue, Filters = item.Filters,
    };

    private static List<string> Unique(IEnumerable<string?> values) => values.OfType<string>().Where(v => v.Length > 0).Distinct().ToList();

    private static T? Parse<T>(JsonElement element) where T : class
    {
        try
        {
            return element.Deserialize<T>(Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
