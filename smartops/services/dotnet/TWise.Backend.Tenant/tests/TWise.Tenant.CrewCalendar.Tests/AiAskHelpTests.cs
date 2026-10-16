using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class AskHelpTests
{
    private static readonly string[] Columns = ["cluster_name", "plant_description", "well_id", "progress_percent"];

    [Fact]
    public void Unknown_column_names_the_closest_columns_not_the_whole_list()
    {
        var text = AskHelp.Friendly("select: unknown column 'plant'. Available columns: cluster_name, plant_description, well_id.", Columns);
        Assert.Equal("This dataset has no column called \"plant\". Did you mean \"plant_description\"? Try naming one of its columns.", text);
    }

    [Fact]
    public void Other_failures_get_a_plain_reason()
    {
        Assert.StartsWith("The question mixed a list of rows with totals.", AskHelp.Friendly("groupBy needs at least one measure.", Columns));
        Assert.StartsWith("The question took too long", AskHelp.Friendly("The dataset query took too long. Ask for fewer groups or add a filter.", Columns));
        Assert.DoesNotContain("SqlException", AskHelp.Friendly("The dataset could not be read: SqlException conversion failed", Columns));
    }

    [Fact]
    public void Suggestions_prefer_similar_good_examples_then_column_templates()
    {
        var examples = new[]
        {
            new AiExample { Id = 1, Question = "wells per cluster", Status = AiExampleStatus.Liked },
            new AiExample { Id = 2, Question = "wells per cluster in 2026", Status = AiExampleStatus.Rejected },
        };
        var profiles = new[]
        {
            new AiColumnStats("well_id", "number", 10, 0, 10, false, "1", "10", [], []),
            new AiColumnStats("cluster_name", "text", 10, 0, 2, false, null, null, [new("Marmul", 6), new("Nimr", 4)], []),
            new AiColumnStats("progress_percent", "number", 10, 0, 8, false, "0", "100", [], []),
        };
        Assert.Equal(["wells per cluster", "How many rows per cluster name?", "Total progress percent by cluster name"],
            AskHelp.Suggestions("count wells by cluster", examples, profiles));
    }

    [Fact]
    public void A_zero_total_or_no_rows_found_nothing()
    {
        var total = new AiQuerySpec(null, null, [new AiMeasure("count", null, "total")], null, null, null);
        AiQueryResult One(object? v) => new(["total"], [new Dictionary<string, object?> { ["total"] = v }], 1, 100, false);
        Assert.True(AskHelp.FoundNothing(total, One(0)));
        Assert.True(AskHelp.FoundNothing(total, One(null)));
        Assert.False(AskHelp.FoundNothing(total, One(1427)));
        Assert.True(AskHelp.FoundNothing(total, new(["total"], [], 0, 100, false)));
        var perCluster = total with { GroupBy = ["cluster_name"] };
        Assert.False(AskHelp.FoundNothing(perCluster, One(0)));
    }
}
