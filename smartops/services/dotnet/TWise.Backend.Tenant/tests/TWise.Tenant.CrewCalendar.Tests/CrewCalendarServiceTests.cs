using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs.Legacy;
using TWise.Tenant.Infrastructure.Services;
using Xunit;
using Activity = TWise.Tenant.Infrastructure.Services.CrewCalendarService.RosterActivity;

namespace TWise.Tenant.CrewCalendar.Tests;

public sealed class CrewCalendarServiceTests
{
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 31);

    [Fact]
    public void CalendarCommandReadsResultTableWithLegacyFilterParameters()
    {
        using var connection = new SqlConnection();
        var project = Guid.Parse("11111111-1111-1111-1111-111111111111");
        using var command = CrewCalendarService.CreateCalendarCommand(connection, " Nimr ", " 3522 ", " A ",
            project.ToString(), new DateTime(2026, 10, 1, 8, 30, 0), new DateTime(2026, 10, 31, 23, 59, 59));

        Assert.Contains("FROM AlTasnimBI.dbo.crew_calendar_result AS result", command.CommandText);
        Assert.DoesNotContain("THROW", command.CommandText);
        Assert.Contains("AND result.well_id IS NOT NULL", command.CommandText);
        Assert.DoesNotContain("NULLIF(LTRIM(RTRIM(result.well_id)), '')", command.CommandText);
        Assert.Contains("WHERE plant_code = TRY_CONVERT(int, @plant)", command.CommandText);
        Assert.DoesNotContain("activity_task_plan", command.CommandText);
        Assert.DoesNotContain("EXEC ", command.CommandText);
        Assert.DoesNotContain("TRUNCATE ", command.CommandText);
        Assert.Equal(6, command.Parameters.Count);
        Assert.Equal(new DateTime(2026, 10, 1), command.Parameters["@fromDate"].Value);
        Assert.Equal(new DateTime(2026, 10, 31), command.Parameters["@toDate"].Value);
        Assert.Equal("Nimr", command.Parameters["@cluster"].Value);
        Assert.Equal("3522", command.Parameters["@plant"].Value);
        Assert.Equal("A", command.Parameters["@wellType"].Value);
        Assert.Equal(SqlDbType.UniqueIdentifier, command.Parameters["@project"].SqlDbType);
        Assert.Equal(project, command.Parameters["@project"].Value);
    }

    [Fact]
    public void CalendarCommandKeepsWideProductivityPrecisionAndOneDecimalRounding()
    {
        using var connection = new SqlConnection();
        using var command = CrewCalendarService.CreateCalendarCommand(connection, null, null, null, null,
            new DateTime(2026, 1, 1), new DateTime(2026, 1, 31));

        Assert.Contains("AS decimal(27,1))", command.CommandText);
        Assert.DoesNotContain("AS decimal(10,1))", command.CommandText);
        Assert.DoesNotContain("TRY_CAST", command.CommandText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("TRY_CONVERT(decimal", command.CommandText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("END AS ProductivityPct", command.CommandText);
        Assert.Equal(new DateTime(2026, 1, 1), command.Parameters["@fromDate"].Value);
        Assert.Equal(new DateTime(2026, 1, 31), command.Parameters["@toDate"].Value);
    }

    [Fact]
    public async Task CalendarUsesItsOwnCacheAndReusesResponseShaping()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var milestone = new CrewCalendarActivityDto("M1", "Rig on", "W1", null,
            "2026-10-05", "2026-10-05", null, null, 0, "milestone", true, null, null);
        memory.Set("bi:crew-cal:v1:::::20261001:20261031",
            new CrewCalendarResponse(0, 0, 0, 0, "2026-10-01", "2026-10-31", [], []));
        memory.Set("bi:crew-cal-result:v1:::::20261001:20261031",
            new CrewCalendarResponse(0, 0, 0, 1, "2026-10-01", "2026-10-31", [], [milestone]));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);

        var result = await CreateService(memory, repository).GetCrewCalendarAsync(null, null, null, null, From, To);

        Assert.Equal(milestone, Assert.Single(result.Milestones));
        Assert.Equal(1, result.TotalMilestones);
        Assert.Empty(result.ActualGroups!);
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task InvalidProjectReturnsAnEmptyCalendarWithoutQueryingTheResultTable()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);

        var result = await CreateService(memory, repository).GetCrewCalendarAsync(
            null, null, null, "not-a-project", From, To);

        Assert.Empty(result.Groups);
        Assert.Empty(result.ActualGroups!);
        repository.VerifyNoOtherCalls();
    }

    private static CrewCalendarService CreateService(IMemoryCache memory, Mock<ICrewAssignmentRepository> repository) =>
        new(new ConfigurationBuilder().Build(), memory, repository.Object,
            new Mock<ILegacyCrewCalendarService>(MockBehavior.Strict).Object,
            NullLogger<CrewCalendarService>.Instance);

    private static readonly DateTime RangeFrom = new(2026, 9, 15);
    private static readonly DateTime RangeTo = new(2026, 9, 18, 23, 59, 59);

    private static readonly DateTime Stamp = new(2026, 10, 20, 5, 54, 56);

    [Theory]
    [InlineData("2026-10-01", "2026-10-31", true)]
    [InlineData("2026-10-18", "2026-10-24", true)]
    [InlineData("2026-10-20", "2026-10-20", true)]
    [InlineData("2026-09-30", "2026-10-31", false)]
    [InlineData("2026-10-01", "2026-11-01", false)]
    [InlineData("2026-08-01", "2026-08-31", false)]
    public void LoadedRangeCoversOnlyRequestsInsideIt(string from, string to, bool expected)
    {
        var loaded = new CrewCalendarService.LoadedRange(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), Stamp);
        Assert.Equal(expected, CrewCalendarService.Covers(loaded, Stamp, DateOnly.Parse(from), DateOnly.Parse(to)));
    }

    [Fact]
    public void LoadedRangeIsUnknownWhenTheTableWasReloadedElsewhereOrNeverLoadedHere()
    {
        var october = (From: new DateOnly(2026, 10, 1), To: new DateOnly(2026, 10, 31));
        var loaded = new CrewCalendarService.LoadedRange(october.From, october.To, Stamp);
        Assert.False(CrewCalendarService.Covers(loaded, Stamp.AddSeconds(1), october.From, october.To));
        Assert.False(CrewCalendarService.Covers(loaded, null, october.From, october.To));
        Assert.False(CrewCalendarService.Covers(null, Stamp, october.From, october.To));
        Assert.True(CrewCalendarService.Covers(loaded with { Stamp = null }, null, october.From, october.To));
    }

    private static CrewCalendarService.RosterSource Source(params CrewCalendarService.RosterActivity[] activities) =>
        new([new("G1", "Group one", "C1", "T1"), new("G1", null, "C2", "T1")], activities,
            new Dictionary<string, List<CrewProjectMappingDto>>(StringComparer.OrdinalIgnoreCase)
            {
                ["C1"] = [new("P1", "NY0010", "Nimr")]
            });

    private static IReadOnlyList<CrewBookingDto> BookingsFor(params CrewCalendarService.RosterActivity[] activities) =>
        CrewCalendarService.BuildRoster(Source(activities), RangeFrom, RangeTo).Groups[0].Crews[0].Bookings;

    [Fact]
    public void RosterKeepsMembersProjectsAndCrewsWithoutBookings()
    {
        var roster = CrewCalendarService.BuildRoster(Source(), RangeFrom, RangeTo);
        var group = Assert.Single(roster.Groups);
        Assert.Equal("Group one", group.CrewGroupName);
        Assert.Equal(["C1", "C2"], group.Crews.Select(crew => crew.CrewUid));
        Assert.Equal("NY0010", Assert.Single(group.Crews[0].Projects!).ProjectCode);
        Assert.All(group.Crews, crew => Assert.Empty(crew.Bookings));
    }

    [Fact]
    public void RosterBookingUsesEarlierActualStartAndLaterActualEnd()
    {
        var booking = Assert.Single(BookingsFor(new Activity("C1", new(2026, 9, 16), new(2026, 9, 17),
            new(2026, 9, 14), new(2026, 9, 20))));
        Assert.Equal(new CrewBookingDto("2026-09-14", "2026-09-20"), booking);
    }

    [Theory]
    [InlineData(2026, 9, 25, "2026-09-25")]
    [InlineData(2026, 9, 16, "2026-09-18")]
    public void OpenActualWorkRunsToTheLaterOfPlannedEndAndRangeEnd(int year, int month, int day, string expectedEnd)
    {
        var booking = Assert.Single(BookingsFor(new Activity("C1", new(2026, 9, 10), new(year, month, day),
            new(2026, 9, 12), null)));
        Assert.Equal(new CrewBookingDto("2026-09-10", expectedEnd), booking);
    }

    [Fact]
    public void MissingAndReversedDatesFallBackToTheRequestedRange()
    {
        Assert.Equal(new CrewBookingDto("2026-09-15", "2026-09-18"),
            Assert.Single(BookingsFor(new Activity("C1", null, null, null, null))));
        Assert.Equal(new CrewBookingDto("2026-09-15", "2026-09-18"),
            Assert.Single(BookingsFor(new Activity("C1", new(2026, 9, 30), new(2026, 9, 1), null, null))));
    }

    [Fact]
    public void BookingsOutsideTheRangeAreDroppedAndDuplicatesCollapsedAcrossCrewCase()
    {
        var bookings = CrewCalendarService.BuildRoster(Source(
                new("C1", new(2026, 9, 1), new(2026, 9, 14), null, null),
                new("C1", new(2026, 9, 19), new(2026, 9, 30), null, null),
                new("C1", new(2026, 9, 16), new(2026, 9, 17), null, null),
                new("c1", new(2026, 9, 16), new(2026, 9, 17), null, null)), RangeFrom, RangeTo)
            .Groups[0].Crews[0].Bookings;
        Assert.Equal(new CrewBookingDto("2026-09-16", "2026-09-17"), Assert.Single(bookings));
    }

    [Fact]
    public async Task RosterReusesOneCachedSourceForEveryDateRangeAndOverlaysAssignments()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        memory.Set(CrewCalendarService.RosterSourceCacheKey,
            Source(new CrewCalendarService.RosterActivity("C1", new(2026, 8, 1), new(2026, 8, 31), null, null)));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetForScopeAsync(null, null, It.IsAny<DateTime>(), It.IsAny<DateTime>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<TWise.Tenant.Domain.Entities.CrewActivityAssignment>
            {
                new() { CrewUid = " c2 ", PlannedStart = new DateTime(2026, 8, 5), PlannedEnd = new DateTime(2026, 8, 6) }
            });
        var service = CreateService(memory, repository);

        var august = await service.GetCrewRosterAsync(new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31));
        var september = await service.GetCrewRosterAsync(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30),
            includeAssignments: false);

        Assert.Equal(new CrewBookingDto("2026-08-01", "2026-08-31"), Assert.Single(august.Groups[0].Crews[0].Bookings));
        Assert.Equal(new CrewBookingDto("2026-08-05", "2026-08-06"), Assert.Single(august.Groups[0].Crews[1].Bookings));
        Assert.All(september.Groups[0].Crews, crew => Assert.Empty(crew.Bookings));
        repository.Verify(repo => repo.GetForScopeAsync(null, null, It.IsAny<DateTime>(), It.IsAny<DateTime>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task PreloadUsesTheSharedSourceWithoutApplyingAssignmentsOrClippingItsDates()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        memory.Set(CrewCalendarService.RosterSourceCacheKey,
            Source(new Activity("C1", new(2026, 8, 1), new(2026, 8, 31), null, null)));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var service = CreateService(memory, repository);

        await service.PreloadRosterAsync();
        var august = await service.GetCrewRosterAsync(new(2026, 8, 1), new(2026, 8, 31), includeAssignments: false);
        var september = await service.GetCrewRosterAsync(new(2026, 9, 1), new(2026, 9, 30), includeAssignments: false);

        Assert.Equal(new CrewBookingDto("2026-08-01", "2026-08-31"), Assert.Single(august.Groups[0].Crews[0].Bookings));
        Assert.All(september.Groups[0].Crews, crew => Assert.Empty(crew.Bookings));
        Assert.Equal("NY0010", Assert.Single(august.Groups[0].Crews[0].Projects!).ProjectCode);
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task PreloadHonorsCancellationEvenWhenTheSourceIsCached()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        memory.Set(CrewCalendarService.RosterSourceCacheKey, Source());
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            CreateService(memory, repository).PreloadRosterAsync(cancellation.Token));
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public void RosterCommandFiltersCandidateKeysWithoutFilteringTheLatestVersion()
    {
        using var connection = new SqlConnection();
        using var command = CrewCalendarService.CreateRosterSourceCommand(connection);
        var lookupStart = command.CommandText.IndexOf("FROM #CrewRosterLatestKeys AS latest", StringComparison.Ordinal);
        var lookupEnd = command.CommandText.IndexOf("DROP TABLE #CrewRosterLatestKeys;", StringComparison.Ordinal);

        Assert.Contains("WHERE NULLIF(LTRIM(RTRIM(crew_uid)), '') IS NOT NULL", command.CommandText[..lookupStart]);
        Assert.DoesNotContain("NULLIF", command.CommandText[lookupStart..lookupEnd], StringComparison.OrdinalIgnoreCase);
        Assert.Contains("detail.project_id IS NOT DISTINCT FROM latest.project_id", command.CommandText);
        Assert.Contains("detail.updated_at DESC, detail.schedule_id DESC, detail.row_id DESC", command.CommandText);
        Assert.Equal(120, command.CommandTimeout);
    }
}
