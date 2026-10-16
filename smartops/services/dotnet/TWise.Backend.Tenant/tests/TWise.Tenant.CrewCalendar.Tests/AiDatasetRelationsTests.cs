using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class AiDatasetRelationsTests
{
    [Fact]
    public void Column_names_are_normalised_and_measures_are_not_keys()
    {
        Assert.Equal("wellcode", DatasetRelations.Normalise("Well Code"));
        Assert.Equal(DatasetRelations.Normalise("well_code"), DatasetRelations.Normalise("WellCode"));
        Assert.True(DatasetRelations.IsKeyLike("well_code"));
        Assert.False(DatasetRelations.IsKeyLike("created_date"));
        Assert.False(DatasetRelations.IsKeyLike("Total Hours"));
    }

    [Fact]
    public void Overlap_is_the_share_of_values_found_in_the_other_column()
    {
        var data = new TableDataDto(["well"], [new() { ["well"] = "W1" }, new() { ["well"] = "w1" }, new() { ["well"] = "W2" }, new() { ["well"] = "" }]);
        var values = DatasetRelations.Values(data, "well");
        Assert.Equal(2, values.Count);
        Assert.Equal(0.5, DatasetRelations.Overlap(values, ["W2", "W9"]));
        Assert.Equal(0, DatasetRelations.Overlap(values, []));
    }

    [Fact]
    public void Only_confirmed_links_reach_the_prompt()
    {
        var rows = new List<AiDatasetRelation>
        {
            new() { FromType = "view", FromId = 1, FromName = "Wells", FromColumn = "well_code", ToType = "view", ToId = 2, ToName = "Downtime", ToColumn = "WellCode", Status = DatasetRelations.Confirmed },
            new() { FromType = "view", FromId = 1, FromName = "Wells", FromColumn = "cluster", ToType = "import", ToId = 3, ToName = "Plan", ToColumn = "Cluster", Status = DatasetRelations.Suggested },
        };
        var text = DatasetRelations.Describe(rows, "view", 2);
        Assert.Contains("Wells (shares WellCode with this dataset's well_code)", text);
        Assert.DoesNotContain("Plan", text);
        Assert.Equal("", DatasetRelations.Describe(rows, "import", 3));
    }
}
