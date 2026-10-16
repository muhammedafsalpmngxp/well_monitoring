using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class InsightsTests
{
    private static AiQuerySpec Spec(string group, string agg = "count") =>
        new(null, [group], [new AiMeasure(agg, null, "n")], null, null, null);

    private static AiQueryResult Result(string group, params (object key, double n)[] rows) =>
        new([group, "n"], rows.Select(r => new Dictionary<string, object?> { [group] = r.key, ["n"] = r.n }).ToList(), rows.Length, 100, false);

    [Fact]
    public void Groups_give_highest_lowest_share_and_total()
    {
        var facts = Insights.Find(Spec("cluster"), Result("cluster", ("Marmul", 60), ("Nimr", 30), ("Fahud", 10)));
        Assert.Contains("Highest n: Marmul with 60, 60% of the total.", facts);
        Assert.Contains("Lowest n: Fahud with 10, 10% of the total.", facts);
        Assert.Contains("Total n across 3 groups: 100.", facts);
    }

    [Fact]
    public void Averages_have_no_share_or_total()
    {
        var facts = Insights.Find(Spec("cluster", "avg"), Result("cluster", ("A", 6), ("B", 3), ("C", 1)));
        Assert.Contains("Highest n: A with 6.", facts);
        Assert.DoesNotContain(facts, f => f.StartsWith("Total"));
    }

    [Fact]
    public void Report_splits_trend_findings_and_anomalies()
    {
        var r = Insights.Report(Spec("month"), Result("month", ("2025-03", 150), ("2025-01", 100), ("2025-02", 90)));
        Assert.Equal(3, r.Trend.Count);
        Assert.Empty(r.Anomalies);
        var outlier = Insights.Report(Spec("well"), Result("well", ("A", 10), ("B", 11), ("C", 9), ("D", 10), ("E", 10), ("F", 500)));
        Assert.Single(outlier.Anomalies);
        Assert.Contains("unusually high", outlier.Anomalies[0]);
        Assert.Equal(Insights.Find(Spec("well"), Result("well", ("A", 10), ("B", 11), ("C", 9), ("D", 10), ("E", 10), ("F", 500))).Count,
            outlier.Trend.Count + outlier.Findings.Count + outlier.Anomalies.Count);
    }

    [Fact]
    public void Months_give_a_trend_in_time_order()
    {
        var facts = Insights.Find(Spec("month"), Result("month", ("2025-03", 150), ("2025-01", 100), ("2025-02", 90)));
        Assert.Contains("N went from 100 in 2025-01 to 150 in 2025-03 (+50%).", facts);
        Assert.Contains("Biggest change between periods: 2025-02 to 2025-03 (+66.7%).", facts);
    }

    [Fact]
    public void A_far_value_is_an_outlier()
    {
        var facts = Insights.Find(Spec("well"), Result("well", ("W1", 10), ("W2", 11), ("W3", 9), ("W4", 10), ("W5", 12), ("W6", 95)));
        Assert.Contains("W6 (95) is unusually high; the typical value is 10.5.", facts);
        Assert.DoesNotContain(facts, f => f.StartsWith("W5"));
    }

    [Fact]
    public void Equal_groups_say_so_instead_of_highest_and_lowest()
    {
        var facts = Insights.Find(Spec("well"), Result("well", ("33105", 1), ("33127", 1), ("33128", 1)));
        Assert.Equal(["All 3 groups have the same n: 1.", "Total n across 3 groups: 3."], facts);
    }

    [Fact]
    public void A_measure_called_total_is_not_doubled()
    {
        var spec = new AiQuerySpec(null, ["plant"], [new AiMeasure("count", null, "total")], null, null, null);
        var result = new AiQueryResult(["plant", "total"],
            new[] { ("A", 935d), ("B", 616d), ("C", 17d) }.Select(r => new Dictionary<string, object?> { ["plant"] = r.Item1, ["total"] = r.Item2 }).ToList(), 3, 100, false);
        Assert.Contains("Total across 3 groups: 1,568.", Insights.Find(spec, result));
    }

    [Fact]
    public void A_large_blank_group_is_named_and_flagged()
    {
        var facts = Insights.Find(Spec("plant"), Result("plant", ("Marmul ODC", 935), ("", 697), ("Nimr ODC", 616), ("Marmul Projects", 17)));
        Assert.Contains("697 (30.8%) have no plant.", facts);
        var highest = Insights.Find(Spec("plant"), Result("plant", ("", 41), ("Marmul ODC", 9), ("Nimr ODC", 0)));
        Assert.Contains("Highest n: (blank) with 41, 82% of the total.", highest);
        Assert.Contains("41 (82%) have no plant.", highest);
        // Distinct counts do not add up, so no share; a blank group at or above the typical size is still flagged.
        var distinct = Insights.Find(Spec("plant", "countDistinct"), Result("plant", ("", 188), ("Marmul ODC", 139), ("Nimr ODC", 83), ("Marmul Projects", 2)));
        Assert.Contains("188 have no plant; missing data, not a real group.", distinct);
        Assert.Contains("Lowest n: Nimr ODC with 0, 0% of the total.", highest);
        var tie = Insights.Find(Spec("plant"), Result("plant", ("", 41), ("Marmul ODC", 9), ("Marmul Projects", 0), ("Nimr ODC", 0)));
        Assert.Contains("Lowest n: Marmul Projects and Nimr ODC with 0 each, 0% of the total.", tie);
        var lowest = Insights.Find(Spec("plant"), Result("plant", ("A", 50), ("B", 40), ("", 2)));
        Assert.Contains("Lowest n: (blank) with 2, 2.2% of the total.", lowest);
    }

    [Fact]
    public void The_answer_ai_sees_blank_groups_as_blank()
    {
        var rows = Result("plant", ("", 188), ("Marmul ODC", 139)).Rows;
        rows[0]["plant"] = null;
        var labelled = Insights.WithBlankLabels(Spec("plant"), rows).ToList();
        Assert.Equal("(blank)", labelled[0]["plant"]);
        Assert.Equal("Marmul ODC", labelled[1]["plant"]);
        Assert.Null(rows[0]["plant"]); // the shown result is not changed
    }

    [Fact]
    public void Too_few_groups_or_no_grouping_give_nothing()
    {
        Assert.Empty(Insights.Find(Spec("cluster"), Result("cluster", ("A", 1), ("B", 2))));
        Assert.Empty(Insights.Find(new AiQuerySpec(["cluster"], null, null, null, null, null), Result("cluster", ("A", 1), ("B", 2), ("C", 3))));
    }
}
