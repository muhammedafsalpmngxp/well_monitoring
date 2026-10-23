using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.CrewAssignments;
using TWise.Tenant.Application.Features.Legacy.CrewCalendar;
using TWise.Tenant.Domain.DTOs.Legacy;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services.Legacy;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public sealed class UnassignedCrewsTests
{
    private static readonly DateOnly From = new(2026, 9, 15);
    private static readonly DateOnly To = new(2026, 9, 18);

    private static UnassignedCrewsResponse LegacyList() => new(2, 3,
    [
        new("FBH-0502", "Bolting", [new("3522-FBH-0502-", "MBH0502"), new("FREE-1", "MBH0502")]),
        new("G2", "Other", [new("BUSY-2", "TYPE2")])
    ]);

    private static void CacheLegacy(IMemoryCache cache, UnassignedCrewsResponse legacy,
        DateOnly from, DateOnly to, string? group = null) =>
        cache.Set($"legacy:unassigned-crews:{group}:{from:yyyyMMdd}:{to:yyyyMMdd}", legacy);

    private static LegacyCrewCalendarService CreateService(IMemoryCache cache,
        Mock<ICrewAssignmentRepository> repository)
    {
        if (!cache.TryGetValue("bi:crew-project-clusters:v1", out _))
            cache.Set("bi:crew-project-clusters:v1", new Dictionary<Guid, string>());
        cache.Set("bi:crew-group-names:v1", new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["G1"] = "Earthworks",
            ["G2"] = "Pipe welding"
        });
        return new(new ConfigurationBuilder().Build(), cache, repository.Object,
            NullLogger<LegacyCrewCalendarService>.Instance);
    }

    [Fact]
    public async Task RosterPreservesEmptyCrewsAndIncludesCrossProjectBookingsWithoutMutatingCache()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var roster = new CrewRosterResponse([new("G1", "Earthworks", [
            new("C1", "T1", [new("2026-09-15", "2026-09-16")], [new("P1", "NY0010", "Nimr")]), new("C2", "T1", [])
        ])]);
        cache.Set($"bi:crew-roster:v1:{From:yyyyMMdd}:{To:yyyyMMdd}", roster);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CrewActivityAssignment>
            {
                new() { CrewUid = " c1 ", CrewGroupCode = "OTHER", ProjectId = "OTHER-PROJECT",
                    PlannedStart = new DateTime(2026, 9, 17), PlannedEnd = new DateTime(2026, 9, 18) }
            });
        var result = await CreateService(cache, repository).GetCrewRosterAsync(From, To);
        Assert.Equal(2, result.Groups[0].Crews.Count);
        Assert.Equal(2, result.Groups[0].Crews[0].Bookings.Count);
        Assert.Empty(result.Groups[0].Crews[1].Bookings);
        Assert.Single(roster.Groups[0].Crews[0].Bookings);
        Assert.Equal(roster.Groups[0].Crews[0].Projects, result.Groups[0].Crews[0].Projects);
        repository.VerifyAll();
    }

    [Fact]
    public async Task SourceOnlyCalendarKeepsUndatedRosterMappingsAndNeverReadsTenantAssignments()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var roster = new CrewRosterResponse([new("G1", "Earthworks", [
            new("C1", "T1", [], [new("P1", "NY0010", "Nimr"), new("P2", "MY0010", "Marmul")]),
            new("C2", "T1", [], [new("UNKNOWN-PROJECT", null, null)]),
            new("C3", "T1", [], [])
        ])]);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var service = CreateService(cache, repository);
        foreach (var start in new[] { From, new DateOnly(2035, 1, 1) })
        {
            var end = start.AddDays(3);
            cache.Set($"bi:crew-roster:v1:{start:yyyyMMdd}:{end:yyyyMMdd}", roster);
            cache.Set($"bi:crew-cal:v1:::::{start:yyyyMMdd}:{end:yyyyMMdd}",
                new CrewCalendarResponse(0, 0, 0, 0, start.ToString("yyyy-MM-dd"), end.ToString("yyyy-MM-dd"), [], []));

            var result = await service.GetCrewRosterAsync(start, end, includeAssignments: false);
            var calendar = await service.GetCrewCalendarAsync(null, null, null, null, start, end, false);

            Assert.Same(roster, result);
            Assert.Equal(3, result.Groups[0].Crews.Count);
            Assert.Equal(new[] { "Nimr", "Marmul" }, result.Groups[0].Crews[0].Projects!.Select(project => project.Cluster));
            Assert.Null(Assert.Single(result.Groups[0].Crews[1].Projects!).Cluster);
            Assert.Empty(result.Groups[0].Crews[2].Projects!);
            Assert.Empty(calendar.Groups);
        }
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task CalendarSeparatesActualSummaryDataFromPlannedRowsWithoutMutatingTheCache()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var planned = new CrewCalendarActivityDto("PLAN", "Planned", "W1", null,
            "2019-01-01", "2026-09-16", null, null, 0, "planned", false, null, null);
        var ongoing = planned with
        {
            ActivityCode = "ONGOING",
            PlannedEnd = "2026-08-31",
            ActualStart = "2026-01-01",
            Progress = 80,
            Status = "inprogress"
        };
        var completed = planned with
        {
            ActivityCode = "ACTUAL-ONLY",
            PlannedStart = "",
            PlannedEnd = "",
            ActualStart = "2026-09-15",
            ActualEnd = "2026-09-16",
            Status = "completed"
        };
        var outside = planned with { ActivityCode = "OUTSIDE", PlannedStart = "2026-10-01", PlannedEnd = "2026-10-02" };
        var legacy = new CrewCalendarResponse(2, 3, 5, 0, "2026-09-15", "2026-09-18", [
            new("G1", 4, 25, [new("C1", [planned, ongoing]), new("HISTORICAL", [completed]), new("", [ongoing])]),
            new("G2", 1, 0, [new("C2", [outside])])
        ], []);
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}", legacy);
        var service = CreateService(cache, new Mock<ICrewAssignmentRepository>(MockBehavior.Strict));
        var result = await service.GetCrewCalendarAsync(null, null, null, null, From, To);

        Assert.Equal(1, result.TotalGroups);
        Assert.Equal(1, result.TotalCrews);
        Assert.Equal(1, result.TotalActivities);
        Assert.Equal(planned, Assert.Single(Assert.Single(Assert.Single(result.Groups).Crews).Activities));
        Assert.Equal(0, result.Groups[0].CompletionPct);
        Assert.Equal(new[] {
            new CrewActualWorkDto("G1", "C1", "2026-01-01", null),
            new CrewActualWorkDto("G1", "HISTORICAL", "2026-09-15", "2026-09-16")
        }, result.ActualCrewWork);
        var actualGroup = Assert.Single(result.ActualGroups!);
        Assert.Equal("Earthworks", actualGroup.CrewGroupName);
        Assert.Equal(new[] { "C1", "HISTORICAL" }, actualGroup.Crews.Select(crew => crew.CrewCode));
        Assert.Equal(new[] { ongoing, completed }, actualGroup.Crews.SelectMany(crew => crew.Activities));
        Assert.Equal(2, legacy.Groups.Count);
        Assert.Equal(2, legacy.Groups[0].Crews[0].Activities.Count);
        Assert.Null(legacy.ActualCrewWork);
        Assert.Null(legacy.ActualGroups);
    }

    [Fact]
    public async Task CalendarPreservesActualSummaryWhenNoPlansOverlap()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var actualOnly = new CrewCalendarActivityDto("ACTUAL", "Actual", "W1", null,
            "", "", null, "2026-09-16", 100, "completed", false, null, null);
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}", new CrewCalendarResponse(
            1, 1, 2, 0, "2026-09-15", "2026-09-18", [new("G1", 2, 100, [new("C1", [actualOnly, actualOnly])])], []));
        var result = await CreateService(cache, new Mock<ICrewAssignmentRepository>(MockBehavior.Strict))
            .GetCrewCalendarAsync(null, null, null, null, From, To);
        Assert.Empty(result.Groups);
        Assert.Equal(0, result.TotalActivities);
        Assert.Equal(new CrewActualWorkDto("G1", "C1", "2026-09-16", "2026-09-16"), Assert.Single(result.ActualCrewWork!));
        var actualGroup = Assert.Single(result.ActualGroups!);
        Assert.Equal("Earthworks", actualGroup.CrewGroupName);
        Assert.Equal("C1", Assert.Single(actualGroup.Crews).CrewCode);
        Assert.All(actualGroup.Crews[0].Activities, activity => Assert.Equal(actualOnly, activity));
    }

    [Fact]
    public async Task CalendarPreservesExactAssignmentIdsAndRefreshesAfterRemoval()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var legacyActivity = new CrewCalendarActivityDto("LEGACY", "Legacy", "W1", null,
            "2026-09-15", "2026-09-18", null, null, 0, "planned", false, null, null);
        var legacy = new CrewCalendarResponse(1, 1, 1, 0, "2026-09-15", "2026-09-18",
            [new("G1", 1, 0, [new("C1", [legacyActivity])])], []);
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}", legacy);
        var first = new CrewActivityAssignment
        {
            Id = 41,
            CrewGroupCode = "G1",
            CrewUid = "C1",
            ActivityCode = "REPEATED",
            WellId = "W1",
            PlannedStart = new DateTime(2026, 9, 15),
            PlannedEnd = new DateTime(2026, 9, 16)
        };
        var second = new CrewActivityAssignment
        {
            Id = 42,
            CrewGroupCode = "G1",
            CrewUid = "C1",
            ActivityCode = "REPEATED",
            WellId = "W1",
            PlannedStart = new DateTime(2026, 9, 17),
            PlannedEnd = new DateTime(2026, 9, 18)
        };
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.SetupSequence(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { first, second })
            .ReturnsAsync(new[] { second });
        var service = CreateService(cache, repository);
        var initial = await service.GetCrewCalendarAsync(null, null, null, null, From, To, true);
        var activities = Assert.Single(Assert.Single(initial.Groups).Crews).Activities;
        Assert.Equal(new long?[] { 41, 42 }, activities.Where(activity => activity.Source == "assignment").Select(activity => activity.AssignmentId));
        Assert.Null(activities.Single(activity => activity.Source == "legacy").AssignmentId);
        var refreshed = await service.GetCrewCalendarAsync(null, null, null, null, From, To, true);
        Assert.DoesNotContain(refreshed.Groups[0].Crews[0].Activities, activity => activity.AssignmentId == 41);
        Assert.Contains(refreshed.Groups[0].Crews[0].Activities, activity => activity.AssignmentId == 42);
        Assert.Single(legacy.Groups[0].Crews[0].Activities);
        repository.VerifyAll();
    }

    [Fact]
    public async Task CalendarPreservesProjectClustersAndKeepsUnmappedAssignmentsWithoutGuessing()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var projectId = Guid.Parse("8c9c6b42-7a12-4eb3-935b-fc0437e7f33f");
        cache.Set("bi:crew-project-clusters:v1", new Dictionary<Guid, string> { [projectId] = "Nimr" });
        var legacyActivity = new CrewCalendarActivityDto("LEGACY", "Legacy", "W1", null,
            "2026-09-15", "2026-09-18", null, null, 0, "planned", false, null, null, Cluster: "Marmul");
        var legacy = new CrewCalendarResponse(1, 1, 1, 0, "2026-09-15", "2026-09-18",
            [new("G1", 1, 0, [new("3522-C1", [legacyActivity])])], []);
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}", legacy);
        var projectIds = new string?[] { $" {projectId.ToString().ToUpperInvariant()} ", null,
            "unmapped-project", "c247e7b4-0751-414a-b59b-701b8bf05443" };
        var assignments = projectIds.Select((project, index) => new CrewActivityAssignment
        {
            Id = index + 1,
            ProjectId = project,
            CrewGroupCode = "G1",
            CrewUid = "3522-C1",
            ActivityCode = $"MAPS-{index}",
            PlannedStart = From.ToDateTime(TimeOnly.MinValue),
            PlannedEnd = To.ToDateTime(TimeOnly.MinValue)
        }).ToArray();
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue), It.IsAny<CancellationToken>()))
            .ReturnsAsync(assignments);

        var result = await CreateService(cache, repository).GetCrewCalendarAsync(null, null, null, null, From, To, true);

        var activities = Assert.Single(Assert.Single(result.Groups).Crews).Activities;
        Assert.Equal(5, result.TotalActivities);
        Assert.Equal("Marmul", activities.Single(activity => activity.Source == "legacy").Cluster);
        Assert.Equal("Nimr", activities.Single(activity => activity.AssignmentId == 1).Cluster);
        Assert.All(activities.Where(activity => activity.AssignmentId > 1), activity => Assert.Null(activity.Cluster));
        Assert.All(activities, activity =>
        {
            Assert.Equal("2026-09-15", activity.PlannedStart);
            Assert.Equal("2026-09-18", activity.PlannedEnd);
        });
        Assert.Equal(legacyActivity, Assert.Single(legacy.Groups[0].Crews[0].Activities));
        repository.VerifyAll();
    }

    [Theory]
    [InlineData("Nimr", null)]
    [InlineData(null, "3522")]
    [InlineData("Nimr", "3522")]
    [InlineData(" Nimr ", " 3522 ")]
    public async Task CalendarScopesAssignmentsByMappedProjectWithoutGuessingUnknownOwnership(string? cluster, string? site)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var projectId = Guid.Parse("8c9c6b42-7a12-4eb3-935b-fc0437e7f33f");
        cache.Set($"bi:crew-scope:v1:{cluster?.Trim()}:{site?.Trim()}", new HashSet<Guid> { projectId });
        var legacy = new CrewCalendarResponse(0, 0, 0, 0, "2026-09-15", "2026-09-18", [], []);
        cache.Set($"bi:crew-cal:v1:{cluster}:{site}:::{From:yyyyMMdd}:{To:yyyyMMdd}", legacy);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var projectIds = new string?[] { $" {projectId.ToString().ToUpperInvariant()} ", null, "",
            "c247e7b4-0751-414a-b59b-701b8bf05443", "unmapped-project" };
        var assignments = projectIds.Select((project, index) => new CrewActivityAssignment
        {
            Id = index + 1,
            ProjectId = project,
            CrewGroupCode = "G1",
            CrewUid = "C1",
            ActivityCode = $"ACT-{index}",
            PlannedStart = From.ToDateTime(TimeOnly.MinValue),
            PlannedEnd = To.ToDateTime(TimeOnly.MinValue)
        }).ToArray();
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue), It.IsAny<CancellationToken>()))
            .ReturnsAsync(assignments);

        var result = await CreateService(cache, repository)
            .GetCrewCalendarAsync(cluster, site, null, null, From, To, true);

        var activity = Assert.Single(Assert.Single(Assert.Single(result.Groups).Crews).Activities);
        Assert.Equal(1L, activity.AssignmentId);
        Assert.Equal(1, result.TotalActivities);
        Assert.Empty(legacy.Groups);
        Assert.Equal(5, assignments.Length);
        repository.VerifyAll();
        repository.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData("Amal", null)]
    [InlineData("GB", null)]
    [InlineData("unknown-cluster", null)]
    [InlineData(null, "unknown-plant")]
    [InlineData("Nimr", "3524")]
    public async Task ScopeWithNoMatchingProjectsDoesNotLeakAssignments(string? cluster, string? site)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        cache.Set($"bi:crew-scope:v1:{cluster}:{site}", new HashSet<Guid>());
        cache.Set($"bi:crew-cal:v1:{cluster}:{site}:::{From:yyyyMMdd}:{To:yyyyMMdd}",
            new CrewCalendarResponse(0, 0, 0, 0, "2026-09-15", "2026-09-18", [], []));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new CrewActivityAssignment
            {
                Id = 1, ProjectId = "8c9c6b42-7a12-4eb3-935b-fc0437e7f33f", CrewGroupCode = "G1", CrewUid = "C1",
                PlannedStart = From.ToDateTime(TimeOnly.MinValue), PlannedEnd = To.ToDateTime(TimeOnly.MinValue)
            } });

        var result = await CreateService(cache, repository)
            .GetCrewCalendarAsync(cluster, site, null, null, From, To, true);

        Assert.Empty(result.Groups);
        Assert.Equal(0, result.TotalActivities);
        repository.VerifyAll();
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task DeletingAnAssignmentSoftDeletesOnlyTheRequestedRecord()
    {
        var assignment = new CrewActivityAssignment { Id = 42, CrewUid = "C1", ActivityCode = "REPEATED" };
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetByIdAsync(42, It.IsAny<CancellationToken>())).ReturnsAsync(assignment);
        repository.Setup(repo => repo.SoftDeleteAsync(assignment, It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        var user = new Mock<ICurrentUserService>();
        user.SetupGet(current => current.UserId).Returns("calendar-user");
        var handler = new DeleteCrewAssignmentHandler(repository.Object, user.Object,
            NullLogger<DeleteCrewAssignmentHandler>.Instance);
        await handler.Handle(new DeleteCrewAssignmentCommand(42), CancellationToken.None);
        Assert.True(assignment.IsDeleted);
        Assert.Equal("calendar-user", assignment.DeletedBy);
        Assert.Equal("REPEATED", assignment.ActivityCode);
        repository.Verify(repo => repo.SoftDeleteAsync(assignment, It.IsAny<CancellationToken>()), Times.Once);
        repository.VerifyAll();
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task RosterTreatsUndatedAssignmentsAsReservedAndRefreshesTenantBookings()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        cache.Set($"bi:crew-roster:v1:{From:yyyyMMdd}:{To:yyyyMMdd}",
            new CrewRosterResponse([new("G1", null, [new("C1", null, [])])]));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.SetupSequence(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CrewActivityAssignment> { new() { CrewUid = "C1" } })
            .ReturnsAsync(Array.Empty<CrewActivityAssignment>());
        var service = CreateService(cache, repository);
        Assert.Equal(new CrewBookingDto("2026-09-15", "2026-09-18"),
            Assert.Single((await service.GetCrewRosterAsync(From, To)).Groups[0].Crews[0].Bookings));
        Assert.Empty((await service.GetCrewRosterAsync(From, To)).Groups[0].Crews[0].Bookings);
        repository.VerifyAll();
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task CalendarRosterIsOptInAndCoversFullActivitySpans(bool includeRoster, bool includeAssignments)
    {
        var service = new Mock<ILegacyCrewCalendarService>(MockBehavior.Strict);
        var activity = new CrewCalendarActivityDto("A", "Activity", "W1", null,
            "2026-08-01", "2026-10-10", null, null, 0, "planned", false, null, null);
        service.Setup(item => item.GetCrewCalendarAsync(null, null, null, null, From, To, includeAssignments,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CrewCalendarResponse(1, 0, 1, 0, "2026-09-15", "2026-09-18",
                [new("G1", 1, 0, [new("", [activity])])], []));
        if (includeRoster)
            service.Setup(item => item.GetCrewRosterAsync(new DateOnly(2026, 8, 1), new DateOnly(2026, 10, 10),
                It.IsAny<CancellationToken>(), includeAssignments)).ReturnsAsync(new CrewRosterResponse([]));
        var handler = new GetCrewCalendarHandler(service.Object, NullLogger<GetCrewCalendarHandler>.Instance);
        await handler.Handle(new GetCrewCalendarQuery(From: "2026-09-15", To: "2026-09-18",
            IncludeAssignments: includeAssignments, IncludeRoster: includeRoster), CancellationToken.None);
        service.VerifyAll();
        service.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task RosterBlocksReversedBookingsInsteadOfTreatingTheCrewAsAvailable()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        cache.Set($"bi:crew-roster:v1:{From:yyyyMMdd}:{To:yyyyMMdd}",
            new CrewRosterResponse([new("G1", null, [new("C1", null, [])])]));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CrewActivityAssignment> {
                new() { CrewUid = "C1", PlannedStart = new DateTime(2026, 9, 18), PlannedEnd = new DateTime(2026, 9, 15) }
            });
        var result = await CreateService(cache, repository).GetCrewRosterAsync(From, To);
        Assert.Equal(new CrewBookingDto("2026-09-15", "2026-09-18"), Assert.Single(result.Groups[0].Crews[0].Bookings));
        repository.VerifyAll();
    }

    [Theory]
    [InlineData("", "", "2026-01-01", null, 0, false, "")]
    [InlineData("2026-01-01", "2032-12-31", "2026-01-01", null, 0, false, "")]
    [InlineData("2026-01-01", "2032-12-31", null, "2026-09-16", 0, false, "")]
    [InlineData("2026-01-01", "2032-12-31", null, null, 20, false, "")]
    [InlineData("2026-01-01", "2032-12-31", null, null, 0, true, "")]
    [InlineData("2026-01-01", "2032-12-31", null, null, 0, false, "SAVED-CREW")]
    [InlineData("2026-09-30", "2026-09-01", null, null, 0, false, "")]
    [InlineData("", "", null, null, 0, false, "")]
    public async Task ActualAndIneligibleWorkDoesNotExpandTheRosterPlanningWindow(
        string plannedStart, string plannedEnd, string? actualStart, string? actualEnd,
        int progress, bool milestone, string crewCode)
    {
        var service = new Mock<ILegacyCrewCalendarService>(MockBehavior.Strict);
        var activity = new CrewCalendarActivityDto("A", "Activity", "W1", null,
            plannedStart, plannedEnd, actualStart, actualEnd, progress, "planned", milestone, null, null);
        service.Setup(item => item.GetCrewCalendarAsync(null, null, null, null, From, To, true,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CrewCalendarResponse(1, 1, 1, 0, "2026-09-15", "2026-09-18",
                [new("G1", 1, 0, [new(crewCode, [activity])])], []));
        service.Setup(item => item.GetCrewRosterAsync(From, To, It.IsAny<CancellationToken>(), true))
            .ReturnsAsync(new CrewRosterResponse([]));
        var handler = new GetCrewCalendarHandler(service.Object, NullLogger<GetCrewCalendarHandler>.Instance);
        await handler.Handle(new GetCrewCalendarQuery(From: "2026-09-15", To: "2026-09-18",
            IncludeAssignments: true, IncludeRoster: true), CancellationToken.None);
        service.VerifyAll();
        service.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CalendarResolvesNamesForLegacyAndMapsGroupsWithoutChangingCodes(bool includeAssignments)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var activity = new CrewCalendarActivityDto("A1", "Planned", "W1", null,
            "2026-09-15", "2026-09-18", null, null, 0, "planned", false, null, null);
        var legacy = new CrewCalendarResponse(1, 1, 1, 0, "2026-09-15", "2026-09-18",
            [new("G1", 1, 0, [new("C1", [activity])])], []);
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}", legacy);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        if (includeAssignments)
        {
            repository.Setup(repo => repo.GetForScopeAsync(null, null,
                    From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<CrewActivityAssignment>
                {
                    new()
                    {
                        CrewGroupCode = "g2", CrewUid = "C2", ActivityCode = "A2",
                        PlannedStart = From.ToDateTime(TimeOnly.MinValue),
                        PlannedEnd = To.ToDateTime(TimeOnly.MinValue)
                    }
                });
        }

        var result = await CreateService(cache, repository).GetCrewCalendarAsync(
            null, null, null, null, From, To, includeAssignments);

        Assert.Equal("Earthworks", result.Groups.Single(group => group.CrewGroupCode == "G1").CrewGroupName);
        if (includeAssignments)
            Assert.Equal("Pipe welding", result.Groups.Single(group => group.CrewGroupCode == "g2").CrewGroupName);
        Assert.Null(legacy.Groups[0].CrewGroupName);
        repository.VerifyAll();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(50)]
    [InlineData(100)]
    public async Task CalendarDoesNotCompleteMapsAssignmentsWithoutActualDates(int progress)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}",
            new CrewCalendarResponse(0, 0, 0, 0, "2026-09-15", "2026-09-18", [], []));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CrewActivityAssignment>
            {
                new()
                {
                    CrewGroupCode = "G1", CrewUid = "C1", ActivityCode = "A1",
                    PlannedStart = From.ToDateTime(TimeOnly.MinValue),
                    PlannedEnd = To.ToDateTime(TimeOnly.MinValue),
                    Progress = progress, Status = "completed"
                }
            });

        var result = await CreateService(cache, repository).GetCrewCalendarAsync(
            null, null, null, null, From, To, includeAssignments: true);

        var group = Assert.Single(result.Groups);
        var activity = Assert.Single(Assert.Single(group.Crews).Activities);
        Assert.Equal("notstarted", activity.Status);
        Assert.Equal(progress, activity.Progress);
        Assert.Null(activity.ActualStart);
        Assert.Null(activity.ActualEnd);
        Assert.Equal(0, group.CompletionPct);
        repository.VerifyAll();
    }

    [Theory]
    [InlineData(-30, 30, true)]
    [InlineData(-2, 0, true)]
    [InlineData(0, 0, true)]
    [InlineData(0, 3, true)]
    [InlineData(3, 7, true)]
    [InlineData(-10, -1, false)]
    [InlineData(4, 8, false)]
    [InlineData(null, 3, false)]
    [InlineData(0, null, false)]
    public async Task CalendarIncludesMapsAssignmentsOverlappingEitherBoundaryOrSpanningTheRange(
        int? startOffset, int? endOffset, bool included)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        cache.Set($"bi:crew-cal:v1:::::{From:yyyyMMdd}:{To:yyyyMMdd}",
            new CrewCalendarResponse(0, 0, 0, 0, "2026-09-15", "2026-09-18", [], []));
        var start = From.ToDateTime(TimeOnly.MinValue);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                start, To.ToDateTime(TimeOnly.MaxValue), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CrewActivityAssignment>
            {
                new()
                {
                    CrewGroupCode = "G1", CrewUid = "C1", ActivityCode = "A1",
                    PlannedStart = startOffset.HasValue ? start.AddDays(startOffset.Value) : null,
                    PlannedEnd = endOffset.HasValue ? start.AddDays(endOffset.Value) : null
                }
            });

        var result = await CreateService(cache, repository).GetCrewCalendarAsync(
            null, null, null, null, From, To, includeAssignments: true);

        Assert.Equal(included ? 1 : 0, result.TotalActivities);
        Assert.Equal(included ? 1 : 0, result.TotalGroups);
        if (included)
        {
            var activity = Assert.Single(Assert.Single(Assert.Single(result.Groups).Crews).Activities);
            Assert.Equal("assignment", activity.Source);
            Assert.Equal("A1", activity.ActivityCode);
        }
        repository.VerifyAll();
    }

    [Fact]
    public async Task CachedListExcludesMapsCrewsAndRecalculatesGroupsAndCounts()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var legacy = LegacyList();
        CacheLegacy(cache, legacy, From, To);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CrewActivityAssignment>
            {
                new() { CrewUid = " 3522-fbh-0502- " },
                new() { CrewUid = "3522-FBH-0502-" },
                new() { CrewUid = "BUSY-2", CrewGroupCode = "DIFFERENT-GROUP" }
            });

        var result = await CreateService(cache, repository).GetUnassignedCrewsAsync(null, From, To);

        Assert.Equal(1, result.TotalGroups);
        Assert.Equal(1, result.TotalCrews);
        Assert.Equal("FREE-1", Assert.Single(Assert.Single(result.Groups).Crews).CrewUid);
        Assert.Equal(3, legacy.TotalCrews);
        Assert.Equal(2, legacy.Groups[0].Crews.Count);
        repository.VerifyAll();
    }

    [Fact]
    public async Task CachedListReflectsAssignmentCreationAndRemovalOnEveryRequest()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var legacy = LegacyList();
        CacheLegacy(cache, legacy, From, To);
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.SetupSequence(repo => repo.GetForScopeAsync(null, null,
                From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<CrewActivityAssignment>())
            .ReturnsAsync(new List<CrewActivityAssignment> { new() { CrewUid = "3522-FBH-0502-" } })
            .ReturnsAsync(Array.Empty<CrewActivityAssignment>());
        var service = CreateService(cache, repository);

        Assert.Equal(3, (await service.GetUnassignedCrewsAsync(null, From, To)).TotalCrews);
        Assert.Equal(2, (await service.GetUnassignedCrewsAsync(null, From, To)).TotalCrews);
        Assert.Equal(3, (await service.GetUnassignedCrewsAsync(null, From, To)).TotalCrews);
        repository.Verify(repo => repo.GetForScopeAsync(null, null,
            From.ToDateTime(TimeOnly.MinValue), To.ToDateTime(TimeOnly.MaxValue),
            It.IsAny<CancellationToken>()), Times.Exactly(3));
    }

    [Theory]
    [InlineData(14)]
    [InlineData(15)]
    [InlineData(18)]
    [InlineData(19)]
    public async Task GroupFilteredRequestChecksAssignmentsAcrossGroupsForTheExactDay(int day)
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var date = new DateOnly(2026, 9, day);
        CacheLegacy(cache, new(1, 1, [new("FBH-0502", "Bolting", [new("3522-FBH-0502-", "MBH0502")])]),
            date, date, "FBH-0502");
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var busy = day is 15 or 18;
        repository.Setup(repo => repo.GetForScopeAsync(null, null,
                date.ToDateTime(TimeOnly.MinValue), date.ToDateTime(TimeOnly.MaxValue),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(busy
                ? new List<CrewActivityAssignment> { new() { CrewUid = "3522-FBH-0502-" } }
                : Array.Empty<CrewActivityAssignment>());

        var result = await CreateService(cache, repository).GetUnassignedCrewsAsync("FBH-0502", date, date);

        Assert.Equal(busy ? 0 : 1, result.TotalCrews);
        Assert.Equal(busy ? 0 : 1, result.TotalGroups);
        repository.VerifyAll();
    }
}