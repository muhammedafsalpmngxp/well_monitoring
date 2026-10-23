using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs.Legacy;
using TWise.Tenant.Infrastructure.Services.Legacy;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public sealed class CrewCalendarCacheTests
{
    [Fact]
    public void RosterRanksFullHistoryIncludingNullWellsBeforeBookingFilters()
    {
        var sql = ReadSql("crew-roster.sql");
        var ranking = sql[..sql.IndexOf(";WITH Bookings AS", StringComparison.Ordinal)];
        Assert.Contains("SELECT DISTINCT project_id, task_code, well_id", ranking);
        Assert.DoesNotContain("ROW_NUMBER()", ranking);
        Assert.Contains("ORDER BY detail.updated_at DESC, detail.schedule_id DESC, detail.row_id DESC", sql);
        Assert.DoesNotContain("well_id IS NOT NULL", ranking);
        Assert.DoesNotContain("@fromDate", ranking);
        Assert.DoesNotContain("@toDate", ranking);
        Assert.Contains("detail.created_at DESC, detail.activity_task_plan_id DESC", ranking);
    }

    [Fact]
    public async Task RosterDoesNotReuseLegacyCacheOrReadAppMasterConnection()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        memory.Set("legacy:crew-roster:20261001:20261031", new CrewRosterResponse([]));
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var service = new LegacyCrewCalendarService(new ConfigurationBuilder().Build(), memory, repository.Object,
            NullLogger<LegacyCrewCalendarService>.Instance);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => service.GetCrewRosterAsync(
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), includeAssignments: false));
        Assert.Contains("ConnectionStrings:AlTasnimBI", error.Message);
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public void CalendarQueryUsesBiDataAndApiParametersWithoutLegacySnapshotIds()
    {
        var sql = ReadSql("crew-calendar.sql");
        Assert.Contains("AlTasnimBI.dbo.activity_task_plan", sql);
        Assert.Contains("AlTasnimBI.well.well_master", sql);
        Assert.Contains("plant.plant_description", sql);
        Assert.Contains("#CrewCalendarCandidateKeys", sql);
        Assert.DoesNotContain("dbo.ActivityTaskPlan", sql);
        Assert.DoesNotContain("WellMonitoringReportOptimized", sql);
        Assert.DoesNotContain("__SHARED_LATEST_ROWS__", sql);
        Assert.DoesNotContain("DECLARE @fromDate", sql);
        Assert.DoesNotContain("DECLARE @toDate", sql);
    }

    [Fact]
    public void CalendarExposesAnUnambiguousProjectPlantWithoutDroppingUnmappedActivities()
    {
        var sql = ReadSql("crew-calendar.sql");
        Assert.Contains("MIN(TRY_CONVERT(int, site_code)) AS PlantCode", sql);
        Assert.Contains("HAVING COUNT(DISTINCT TRY_CONVERT(int, site_code)) = 1", sql);
        Assert.Contains("LEFT JOIN ProjectPlants AS project ON project.project_id = activity.ProjectId", sql);
        Assert.Contains("project.PlantCode", sql);
        var activity = new CrewCalendarActivityDto("TASK", "Task", "28721", null,
            "2026-08-01", "2026-08-02", "2026-08-01", "2026-08-02", 100, "completed", false, null, null,
            PlantCode: 3522);
        Assert.Equal("28721", activity.WellId);
        Assert.Equal(3522, activity.PlantCode);
    }

    [Fact]
    public void CalendarFiltersCoveredLatestDatesBeforeRetrievingWideActivityDetails()
    {
        var sql = ReadSql("crew-calendar.sql");
        var start = sql.IndexOf("SELECT latest.row_id, latest.activity_task_plan_id", StringComparison.Ordinal);
        var end = sql.IndexOf(";WITH ActivityGroups AS", StringComparison.Ordinal);
        Assert.True(start >= 0 && end > start);
        var coveredStage = sql[start..end];
        Assert.Contains("INTO #CrewCalendarEligibleKeys", coveredStage);
        Assert.Contains("SELECT TOP (1)", coveredStage);
        Assert.Contains("detail.task_code IS NOT DISTINCT FROM candidate.task_code", coveredStage);
        Assert.Contains("actual.EndedOn >= actual.StartedOn", coveredStage);
        Assert.DoesNotContain("task_description", coveredStage);
        Assert.Contains("FROM #CrewCalendarEligibleKeys AS latest", sql);
        Assert.Contains("detail.activity_task_plan_id = latest.activity_task_plan_id", sql);
    }

    [Fact]
    public void RosterQueryUsesBiMastersBookingsAndActivityProjectAssociations()
    {
        var sql = ReadSql("crew-roster.sql");
        Assert.Contains("AlTasnimBI.ref.crew", sql);
        Assert.Contains("AlTasnimBI.ref.crew_type", sql);
        Assert.Contains("AlTasnimBI.dbo.activity_task_plan", sql);
        Assert.Contains("AlTasnimBI.project.project_mstr", sql);
        Assert.DoesNotContain("TaskCrew", sql);
        Assert.DoesNotContain("@latestRowsJson", sql);
        Assert.DoesNotContain("dbo.ActivityTaskPlan", sql);
        Assert.Contains("SELECT TOP (1)", sql);
        Assert.Contains("detail.well_id IS NOT DISTINCT FROM latest.well_id", sql);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public void CalendarCommandBindsEveryOptionalParameterAndUsesDateBounds(string? filter)
    {
        using var connection = new SqlConnection();
        using var command = LegacyCrewCalendarService.CreateCalendarCommand(connection, filter, filter, filter, filter,
            new DateTime(2026, 10, 1, 8, 30, 0), new DateTime(2026, 10, 31, 23, 59, 59));
        Assert.Equal(6, command.Parameters.Count);
        Assert.Equal(120, command.CommandTimeout);
        Assert.Equal(SqlDbType.Date, command.Parameters["@fromDate"].SqlDbType);
        Assert.Equal(SqlDbType.Date, command.Parameters["@toDate"].SqlDbType);
        Assert.Equal(new DateTime(2026, 10, 1), command.Parameters["@fromDate"].Value);
        Assert.Equal(new DateTime(2026, 10, 31), command.Parameters["@toDate"].Value);
        foreach (var name in new[] { "@cluster", "@plant", "@wellType", "@project" })
            Assert.Equal(DBNull.Value, command.Parameters[name].Value);
        Assert.DoesNotContain("@latestRowsJson", command.CommandText);
    }

    [Theory]
    [InlineData(" Nimr ODC ", "Nimr ODC")]
    [InlineData(" 3522 ", "3522")]
    public void CalendarCommandAcceptsPlantDescriptionsAndExistingNumericSiteCodes(string site, string expected)
    {
        using var connection = new SqlConnection();
        var project = Guid.Parse("11111111-1111-1111-1111-111111111111");
        using var command = LegacyCrewCalendarService.CreateCalendarCommand(connection, " Nimr ", site, " A ",
            project.ToString(), new DateTime(2026, 10, 1), new DateTime(2026, 10, 31));
        Assert.Equal("Nimr", command.Parameters["@cluster"].Value);
        Assert.Equal(expected, command.Parameters["@plant"].Value);
        Assert.Equal("A", command.Parameters["@wellType"].Value);
        Assert.Equal(SqlDbType.UniqueIdentifier, command.Parameters["@project"].SqlDbType);
        Assert.Equal(project, command.Parameters["@project"].Value);
        Assert.Contains("WHERE plant_code = TRY_CONVERT(int, @plant)", command.CommandText);
    }

    [Fact]
    public async Task CalendarDoesNotReuseCachedAppMasterDataOrFallBackToItsConnection()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var from = new DateOnly(2026, 10, 1);
        var to = new DateOnly(2026, 10, 31);
        memory.Set("legacy:crew-cal:::::20261001:20261031",
            new CrewCalendarResponse(0, 0, 0, 0, "2026-10-01", "2026-10-31", [], []));
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:LegacyWellsDb"] = "not a BI connection"
        }).Build();
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var service = new LegacyCrewCalendarService(configuration, memory, repository.Object,
            NullLogger<LegacyCrewCalendarService>.Instance);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.GetCrewCalendarAsync(null, null, null, null, from, to));
        Assert.Contains("ConnectionStrings:AlTasnimBI", error.Message);
        repository.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task InvalidProjectDoesNotBecomeAnUnfilteredBiRequest()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var repository = new Mock<ICrewAssignmentRepository>(MockBehavior.Strict);
        var service = new LegacyCrewCalendarService(new ConfigurationBuilder().Build(), memory, repository.Object,
            NullLogger<LegacyCrewCalendarService>.Instance);
        var result = await service.GetCrewCalendarAsync(null, null, null, "not-a-project",
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31));
        Assert.Empty(result.Groups);
        Assert.Empty(result.ActualGroups!);
        repository.VerifyNoOtherCalls();
    }

    private static string ReadSql(string suffix)
    {
        var assembly = typeof(LegacyCrewCalendarService).Assembly;
        var resource = Assert.Single(assembly.GetManifestResourceNames(), name => name.EndsWith(suffix, StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    [Fact]
    public async Task ConcurrentRequestsAcrossServiceInstancesShareOneLoad()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        Task<string> Load(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref calls);
            return completion.Task.WaitAsync(cancellationToken);
        }

        var first = new CrewCalendarCache(memory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), Load, default);
        var second = new CrewCalendarCache(memory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), Load, default);
        completion.SetResult("result");

        Assert.Equal(new[] { "result", "result" }, await Task.WhenAll(first, second));
        Assert.Equal(1, calls);
        Assert.Equal("result", await new CrewCalendarCache(memory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), Load, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task CancelledWaiterDoesNotCancelTheSharedLoad()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        using var cancellation = new CancellationTokenSource();
        var coordinator = new CrewCalendarCache(memory);
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => completion.Task, default);
        var waiter = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("unexpected"), cancellation.Token);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiter);
        completion.SetResult("result");
        Assert.Equal("result", await first);
    }

    [Fact]
    public async Task SurvivingWaiterRetriesWhenTheOriginalLoaderIsCancelled()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        using var cancellation = new CancellationTokenSource();
        var coordinator = new CrewCalendarCache(memory);
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), token => completion.Task.WaitAsync(token), cancellation.Token);
        var waiter = coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("recovered"), default);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        Assert.Equal("recovered", await waiter);
    }

    [Fact]
    public async Task FailedLoadsAreNotCachedAndCanBeRetried()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(memory);
        await Assert.ThrowsAsync<InvalidOperationException>(() => coordinator.GetOrCreateAsync<string>(
            "calendar", TimeSpan.FromMinutes(5), _ => Task.FromException<string>(new InvalidOperationException()), default));
        Assert.Equal("recovered", await coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("recovered"), default));
    }

    [Fact]
    public async Task LoaderCancellationWithoutCallerCancellationIsNotRetriedForever()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(memory);
        var calls = 0;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => coordinator.GetOrCreateAsync<string>(
            "calendar", TimeSpan.FromMinutes(5), _ =>
            {
                calls++;
                return Task.FromCanceled<string>(new CancellationToken(true));
            }, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task DependentResultDoesNotOutliveItsSnapshot()
    {
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(memory);
        var result = await coordinator.GetOrCreateAsync("roster", TimeSpan.FromMinutes(5),
            _ => Task.FromResult("result"), default, _ => DateTimeOffset.UtcNow.AddSeconds(-1));
        Assert.Equal("result", result);
        Assert.False(memory.TryGetValue("roster", out _));
    }

    [Fact]
    public async Task DifferentScopesAndMemoryCachesRemainIndependent()
    {
        using var firstMemory = new MemoryCache(new MemoryCacheOptions());
        using var secondMemory = new MemoryCache(new MemoryCacheOptions());
        var coordinator = new CrewCalendarCache(firstMemory);
        Assert.Equal("first", await coordinator.GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("first"), default));
        Assert.Equal("other scope", await coordinator.GetOrCreateAsync("roster", TimeSpan.FromMinutes(5), _ => Task.FromResult("other scope"), default));
        Assert.Equal("other database", await new CrewCalendarCache(secondMemory).GetOrCreateAsync("calendar", TimeSpan.FromMinutes(5), _ => Task.FromResult("other database"), default));
    }
}