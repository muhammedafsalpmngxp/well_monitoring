using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Key findings and the insight report for Ask Data answers (SQL, no spec): the spec is read from the answer.</summary>
public class AskDataInsightsTests
{
    private const string LiftTypeSql = """
        SELECT wm.lift_type, COUNT(DISTINCT wm.well_id) AS well_count, COUNT(*) OVER() AS total_matching_rows
        FROM well.well_master AS wm GROUP BY wm.lift_type ORDER BY wm.lift_type
        """;

    private static AiQueryResult LiftTypes()
    {
        var counts = new (string? type, long n)[] { (null, 290), ("BP", 16), ("DWI", 5), ("ESP", 53), ("OP", 23), ("PCP", 294), ("PI", 55), ("WI", 99), ("WSW", 6) };
        var rows = counts.Select(c => new Dictionary<string, object?> { ["lift_type"] = c.type, ["well_count"] = c.n, ["total_matching_rows"] = 9L }).ToList();
        return new AiQueryResult(["lift_type", "well_count", "total_matching_rows"], rows, rows.Count, rows.Count, false);
    }

    [Fact]
    public void A_grouped_answer_gets_checked_findings_from_its_own_rows()
    {
        var spec = AskDataInsights.Spec(LiftTypeSql, LiftTypes())!;

        spec.GroupBy.Should().Equal("lift_type");                                   // the constant total is not the measure
        spec.Measures.Should().ContainSingle().Which.Should().Be(new AiMeasure("count", "well_count", "well_count"));
        var findings = Insights.Find(spec, LiftTypes());
        findings.Should().Contain(f => f.Contains("PCP") && f.Contains("294") && f.Contains("35"));   // highest, share of the 841 wells
        findings.Should().Contain(f => f.Contains("290") && f.Contains("no lift type"));             // the blank group
        findings.Should().Contain(f => f.Contains("841"));                                          // the total adds up
    }

    [Fact]
    public void Only_counts_and_sums_add_up_and_small_or_ungrouped_answers_get_none()
    {
        var avg = new AiQueryResult(["cluster", "avg_progress"], [
            new() { ["cluster"] = "Nimr", ["avg_progress"] = 41.5 }, new() { ["cluster"] = "Marmul", ["avg_progress"] = 63.0 },
            new() { ["cluster"] = "Amal", ["avg_progress"] = 12.25 }], 3, 3, false);
        AskDataInsights.Spec("SELECT cluster, AVG(progress) AS avg_progress FROM t GROUP BY cluster", avg)!
            .Measures![0].Agg.Should().Be("avg");

        var two = new AiQueryResult(["cluster", "n"], [new() { ["cluster"] = "Nimr", ["n"] = 393L }, new() { ["cluster"] = "Marmul", ["n"] = 448L }], 2, 2, false);
        AskDataInsights.Spec("SELECT ...", two).Should().BeNull();
        var numbers = new AiQueryResult(["well_id"], Enumerable.Range(1, 5).Select(i => new Dictionary<string, object?> { ["well_id"] = (long)i }).ToList(), 5, 5, false);
        AskDataInsights.Spec("SELECT well_id FROM t", numbers).Should().BeNull();       // nothing to group by
    }

    [Fact]
    public void A_year_number_is_a_period_to_group_by()
    {
        var years = new AiQueryResult(["year", "wells"], new[] { 2024L, 2025L, 2026L }
            .Select((y, i) => new Dictionary<string, object?> { ["year"] = y, ["wells"] = (long)(10 + i * 5) }).ToList(), 3, 3, false);
        var spec = AskDataInsights.Spec("SELECT YEAR(d) AS year, COUNT(*) AS wells FROM t GROUP BY YEAR(d)", years)!;
        spec.GroupBy.Should().Equal("year");
        Insights.Report(spec, years).Trend.Should().NotBeEmpty();
    }

    [Fact]
    public void The_report_reruns_the_query_the_answer_used_not_a_rejected_one()
    {
        AiTraceStep[] trace =
        [
            new("ask", 1200, "Ask Data (route sql): orchestrator → sql_author → validator → executor"),
            new("query", 0, "SELECT lift_type, COUNT(*) AS n\nFROM well.well_master GROUP BY lift_type\n9 rows"),
            new("query", 0, "SELECT * FROM well.well_master\n0 rows (rejected, not used for the answer)"),
        ];
        AskDataInsights.AcceptedSql(trace).Should().Be("SELECT lift_type, COUNT(*) AS n\nFROM well.well_master GROUP BY lift_type");
        AskDataInsights.AcceptedSql([trace[0]]).Should().BeNull();
        AskDataInsights.AcceptedSql(null).Should().BeNull();
    }
}
