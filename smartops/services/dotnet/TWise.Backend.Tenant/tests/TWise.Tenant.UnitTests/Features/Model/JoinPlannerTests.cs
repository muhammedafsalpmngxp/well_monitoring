using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class JoinPlannerTests
{
    private static readonly ModelSource Well = new(1, "w", "core", "Well", "none", null);
    private static readonly ModelSource Daily = new(2, "d", "core", "WellDaily", "none", null);
    private static readonly ModelSource Crew = new(3, "c", "core", "Crew", "none", null);
    private static readonly ModelSource[] All = [Well, Daily, Crew];

    private static readonly ModelRelationship DailyToWell = new(10, 2, "WellId", 1, "WellId", "many_to_one");
    private static readonly ModelRelationship CrewToWell = new(11, 3, "WellId", 1, "WellId", "many_to_one");

    [Fact]
    public void Single_source_needs_no_joins()
        => JoinPlanner.Plan([Well], All, [DailyToWell]).Should().BeEmpty();

    [Fact]
    public void Joins_are_ordered_so_each_one_refers_to_sources_already_in_scope()
    {
        var steps = JoinPlanner.Plan([Daily, Crew], All, [DailyToWell, CrewToWell]);

        steps.Select(s => s.Joined.Alias).Should().Equal("w", "c");
    }

    [Fact]
    public void Unrelated_sources_are_refused()
    {
        var act = () => JoinPlanner.Plan([Well, Daily], All, []);

        act.Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.MissingRelationship && e.Message.Contains("w and d are not related"));
    }

    [Fact]
    public void Two_paths_between_sources_are_refused_not_guessed()
    {
        var second = new ModelRelationship(12, 2, "OriginWellId", 1, "WellId", "many_to_one");

        var act = () => JoinPlanner.Plan([Well, Daily], All, [DailyToWell, second]);

        act.Should().Throw<QueryException>().Where(e => e.Code == QueryErrors.AmbiguousPath);
    }

    [Fact]
    public void Chain_joins_include_the_intermediate_sources_in_order()
    {
        var pump = new ModelSource(4, "p", "core", "Pump", "none", null);
        var dailyToCrew = new ModelRelationship(13, 2, "CrewId", 3, "CrewId", "many_to_one");
        var crewToPump = new ModelRelationship(14, 3, "PumpId", 4, "PumpId", "many_to_one");

        var steps = JoinPlanner.Plan([Well, pump], [.. All, pump], [DailyToWell, dailyToCrew, crewToPump]);

        steps.Select(s => s.Joined.Alias).Should().Equal("d", "c", "p");
    }

    [Fact]
    public void A_dense_cluster_elsewhere_does_not_slow_planning()
    {
        // Twelve sources all related to each other, one of them related to the root.
        // Enumerating every simple path through them never finishes.
        var cluster = Enumerable.Range(100, 12).Select(i => new ModelSource(i, "s" + i, "core", "T" + i, "none", null)).ToList();
        var relationships = new List<ModelRelationship> { DailyToWell, new(50, 100, "WellId", 1, "WellId", "many_to_one") };
        var nextId = 1000L;
        foreach (var a in cluster)
            foreach (var b in cluster.Where(b => b.Id > a.Id))
                relationships.Add(new ModelRelationship(nextId++, a.Id, "K", b.Id, "K", "many_to_one"));

        IReadOnlyList<JoinStep>? steps = null;
        var finished = Task.Run(() => steps = JoinPlanner.Plan([Well, Daily], [.. All, .. cluster], relationships))
            .Wait(TimeSpan.FromSeconds(5));

        finished.Should().BeTrue();
        steps!.Select(s => s.Via.Id).Should().Equal(10);
    }
}
