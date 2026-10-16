using System.Text.Json;
using TWise.Tenant.Application.Features.Ai;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class ColumnProfilerTests
{
    private static IReadOnlyList<AiColumnStats> Profile(string[] columns, params object?[][] rows)
    {
        var p = new ColumnProfiler(columns);
        foreach (var r in rows) p.Add(columns.Select((c, i) => (c, r[i])).ToDictionary(x => x.c, x => x.Item2));
        return p.Build();
    }

    [Fact]
    public void Low_cardinality_text_lists_every_value_with_counts()
    {
        var s = Profile(["Plant"], ["Marmul ODC"], ["Nimr ODC"], ["Marmul ODC"], [null], [""])[0];
        Assert.Equal("text", s.Type);
        Assert.Equal(5, s.Rows);
        Assert.Equal(2, s.Nulls);
        Assert.Equal(2, s.Distinct);
        Assert.Equal("Plant (text) 2 values: Marmul ODC (2), Nimr ODC (1) | 2 empty", ColumnProfiler.Describe(s));
    }

    [Fact]
    public void Numbers_and_dates_get_a_range_compared_as_values_not_text()
    {
        var rows = Enumerable.Range(1, 30).Select(i => new object?[] { i * 10, new DateTime(2026, 1, i) }).ToArray();
        var stats = Profile(["progress", "start_date"], rows);
        Assert.Equal(("number", "10", "300"), (stats[0].Type, stats[0].Min, stats[0].Max));
        Assert.Equal(("date", "2026-01-01", "2026-01-30"), (stats[1].Type, stats[1].Min, stats[1].Max));
        Assert.StartsWith("progress (number) 30 distinct | range 10 to 300 | e.g. 10, 20, 30", ColumnProfiler.Describe(stats[0]));
    }

    [Fact]
    public void Imported_json_values_are_profiled_like_sql_values()
    {
        var doc = JsonDocument.Parse("""[{"Qty":5},{"Qty":7},{"Qty":null}]""");
        var p = new ColumnProfiler(["Qty"]);
        foreach (var e in doc.RootElement.EnumerateArray()) p.Add(new Dictionary<string, object?> { ["Qty"] = e.GetProperty("Qty") });
        var s = p.Build()[0];
        Assert.Equal(("number", 1L, "5", "7"), (s.Type, s.Nulls, s.Min, s.Max));
    }

    [Fact]
    public void Empty_column_is_described_as_such() =>
        Assert.Equal("Notes (text) always empty", ColumnProfiler.Describe(Profile(["Notes"], [null], [""])[0]));
}

public class ProfileSqlTests
{
    [Fact]
    public void Stats_query_counts_and_ranges_each_column_in_one_pass()
    {
        var sql = ProfileSql.Stats("SELECT * FROM dbo.atp ORDER BY id", [("Cluster", "text"), ("progress", "number"), ("photo", "binary")])!;
        Assert.Contains("COUNT(*) AS [__rows]", sql);
        Assert.Contains("COUNT(DISTINCT [Cluster]) AS [d0]", sql);
        Assert.Contains("MIN([progress]) AS [mn1], MAX([progress]) AS [mx1]", sql);
        Assert.DoesNotContain("MIN([Cluster])", sql);
        Assert.DoesNotContain("[photo]", sql);
        Assert.Contains("FROM (SELECT * FROM dbo.atp) AS _ai_src", sql);
    }

    [Fact]
    public void Values_query_groups_every_low_cardinality_column_in_one_scan()
    {
        var sql = ProfileSql.Values("SELECT * FROM t", [(0, "Cluster"), (3, "Status")])!;
        Assert.Contains("GROUPING([Cluster]) AS [g0]", sql);
        Assert.Contains("CAST([Status] AS nvarchar(400)) AS [v3]", sql);
        Assert.EndsWith("GROUP BY GROUPING SETS (([Cluster]), ([Status]))", sql);
    }

    [Fact]
    public void Batch_views_are_left_to_streaming() =>
        Assert.Null(ProfileSql.Stats("DECLARE @y int = 1; SELECT * FROM t", [("a", "text")]));
}
