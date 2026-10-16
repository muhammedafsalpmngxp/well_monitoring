using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class AlertCheckTests
{
    private static readonly AiQuerySpec Total = new(null, null, [new AiMeasure("count", null, "n")], null, null, null);
    private static readonly AiQuerySpec PerWell = new(null, ["well"], [new AiMeasure("sum", "hours", "n")], null, null, null);

    private static AiQueryResult One(double n) =>
        new(["n"], [new Dictionary<string, object?> { ["n"] = n }], 1, 100, false);

    private static AiQueryResult Wells(params (string well, double n)[] rows) =>
        new(["well", "n"], rows.Select(r => new Dictionary<string, object?> { ["well"] = r.well, ["n"] = r.n }).ToList(), rows.Length, 100, false);

    [Fact]
    public void A_single_number_above_the_limit_fires()
    {
        var o = AlertCheck.Evaluate(AlertCheck.Above, 50, Total, One(60), []);
        Assert.True(o.Fired);
        Assert.Equal(60, o.Value);
        Assert.Equal("N is 60, above the limit of 50.", o.Message);
        Assert.False(AlertCheck.Evaluate(AlertCheck.Below, 50, Total, One(60), []).Fired);
    }

    [Fact]
    public void Groups_crossing_the_limit_are_listed_highest_first()
    {
        var o = AlertCheck.Evaluate(AlertCheck.Above, 10, PerWell, Wells(("W1", 5), ("W2", 14), ("W3", 30)), []);
        Assert.True(o.Fired);
        Assert.Null(o.Value);
        Assert.Equal("2 of 3 groups above 10: W3 (30), W2 (14).", o.Message);
    }

    [Fact]
    public void Unusual_waits_for_enough_history_then_compares_with_it()
    {
        var learning = AlertCheck.Evaluate(AlertCheck.Unusual, null, Total, One(500), [10, 11, 9]);
        Assert.False(learning.Fired);
        Assert.Equal("N is 500. Learning the usual range (4 of 5 checks done).", learning.Message);
        Assert.Contains("(1 of 5 checks done)", AlertCheck.Evaluate(AlertCheck.Unusual, null, Total, One(7), []).Message);
        var usual = AlertCheck.Evaluate(AlertCheck.Unusual, null, Total, One(11), [10, 11, 9, 10, 12]);
        Assert.False(usual.Fired);
        var spike = AlertCheck.Evaluate(AlertCheck.Unusual, null, Total, One(60), [10, 11, 9, 10, 12]);
        Assert.True(spike.Fired);
        Assert.Equal("N is 60, unusually high; usually about 10.", spike.Message);
    }

    [Fact]
    public void A_value_that_never_moved_is_unusual_when_it_changes() =>
        Assert.True(AlertCheck.Evaluate(AlertCheck.Unusual, null, Total, One(1), [0, 0, 0, 0, 0]).Fired);

    [Fact]
    public void Unusual_groups_are_found_among_the_others()
    {
        var o = AlertCheck.Evaluate(AlertCheck.Unusual, null, PerWell, Wells(("W1", 10), ("W2", 11), ("W3", 9), ("W4", 10), ("W5", 12), ("W6", 95)), []);
        Assert.True(o.Fired);
        Assert.StartsWith("1 of 6 groups unusual", o.Message);
        Assert.EndsWith("W6 (95).", o.Message);
    }

    [Fact]
    public void A_row_list_watches_the_number_of_rows()
    {
        var rows = new AiQuerySpec(["well"], null, null, null, null, null);
        var o = AlertCheck.Evaluate(AlertCheck.Above, 0, rows, new(["well"], [new() { ["well"] = "W1" }], 1, 100, false), []);
        Assert.True(o.Fired);
        Assert.Equal("Number of rows is 1, above the limit of 0.", o.Message);
    }

    [Fact]
    public void Change_compares_with_the_previous_check_in_percent()
    {
        Assert.Contains("next check compares", AlertCheck.Evaluate(AlertCheck.Change, 10, Total, One(100), []).Message);
        var o = AlertCheck.Evaluate(AlertCheck.Change, 10, Total, One(125), [90, 100]);
        Assert.True(o.Fired);
        Assert.Equal("N changed by 25% (100 → 125), more than the 10% allowed.", o.Message);
        Assert.False(AlertCheck.Evaluate(AlertCheck.Change, 10, Total, One(105), [100]).Fired);
        // From zero any move is a change; grouped answers cannot be watched this way.
        Assert.True(AlertCheck.Evaluate(AlertCheck.Change, 50, Total, One(3), [0]).Fired);
        Assert.False(AlertCheck.Evaluate(AlertCheck.Change, 10, PerWell, Wells(("W1", 5)), []).Fired);
    }
}
