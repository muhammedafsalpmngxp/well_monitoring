using System.Text.Json;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.DaxModels;

internal static class DaxModelMapping
{
    public static void Apply(SavedDaxModel model, DaxModelSaveRequest r)
    {
        model.Name = r.Name.Trim();
        model.SourceType = r.SourceType;
        model.DataSource = r.DataSource.Trim();
        model.CalculatedBy = r.CalculatedBy;
        model.Operation = string.IsNullOrWhiteSpace(r.Operation) ? null : r.Operation.Trim();
        var columns = (r.Columns ?? []).Select(col => col.Trim()).Where(col => col.Length > 0).Distinct().ToList();
        model.ColumnsJson = columns.Count == 0 ? null : JsonSerializer.Serialize(columns);
        model.Expression = r.Expression.Trim();
        model.Status = r.Status ?? "Active";
    }

    public static DaxModelDto ToDto(SavedDaxModel m, int usedInCharts, string? createdByName = null) =>
        new(m.Id, m.Name, m.SourceType, m.DataSource, m.CalculatedBy, m.Operation, ParseColumns(m.ColumnsJson),
            m.Expression, m.Status, usedInCharts, m.CreatedAt, createdByName);

    // A malformed column list must not hide the model; it is shown without columns.
    private static IReadOnlyList<string> ParseColumns(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? []; }
        catch (JsonException) { return []; }
    }
}
