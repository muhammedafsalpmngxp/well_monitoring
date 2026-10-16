using TWise.Tenant.Application.Features.Ai;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class ClarificationTests
{
    private static readonly string[] Columns = ["cluster_name", "plant_description", "well_id"];

    [Fact]
    public void Valid_options_are_kept_and_checked_against_the_columns()
    {
        var c = Clarification.TryParse("""
            {"clarify":"Marmul as a cluster or as a plant?","options":[
              {"label":"Cluster Marmul","spec":{"measures":[{"agg":"count"}],"filters":[{"column":"CLUSTER_NAME","op":"eq","value":"Marmul"}]}},
              {"label":"Plant Marmul ODC","spec":{"measures":[{"agg":"count"}],"filters":[{"column":"plant_description","op":"eq","value":"Marmul ODC"}]}},
              {"label":"Bad column","spec":{"measures":[{"agg":"count"}],"filters":[{"column":"plant","op":"eq","value":"x"}]}}]}
            """, Columns)!;
        Assert.Equal("Marmul as a cluster or as a plant?", c.Question);
        Assert.Equal(["Cluster Marmul", "Plant Marmul ODC"], c.Options.Select(o => o.Label));
        Assert.Equal("cluster_name", c.Options[0].Spec.Filters![0].Column); // resolved to the real name
    }

    [Fact]
    public void A_normal_spec_is_not_a_clarification() =>
        Assert.Null(Clarification.TryParse("""{"measures":[{"agg":"count"}]}""", Columns));

    [Fact]
    public void At_most_three_options() =>
        Assert.Equal(3, Clarification.TryParse("""{"clarify":"?","options":[""" +
            string.Join(",", Enumerable.Range(1, 5).Select(i => "{\"label\":\"o" + i + "\",\"spec\":{\"measures\":[{\"agg\":\"count\"}]}}")) + "]}", Columns)!.Options.Count);

    [Fact]
    public void A_missing_reply_is_read_and_a_spec_is_not()
    {
        Assert.Equal("This dataset has no downtime column.", Clarification.Missing("""{"missing":"This dataset has no downtime column."}"""));
        Assert.Null(Clarification.Missing("""{"measures":[{"agg":"count"}]}"""));
        Assert.Null(Clarification.Missing("not json"));
    }
}
