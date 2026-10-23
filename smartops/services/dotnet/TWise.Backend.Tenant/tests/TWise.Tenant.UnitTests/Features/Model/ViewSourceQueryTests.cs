using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model;

/// <summary>Queries and previews of view sources: a query reads the SQL stored when the view was added, a preview the view as it is now.</summary>
public sealed class ViewSourceQueryTests
{
    private static bool AnyTable(string schema, string table) => true;

    private const string Grain = "One row per crew type.";

    private readonly ModelCache _cache = NewCache();
    private readonly Mock<IDatasetRepository> _repo;
    private readonly Mock<IModelQueryService> _runner = new();
    private readonly List<CompiledQuery> _ran = [];
    private PreparedView _view = CrewView();
    private readonly DatasetSource _crews;

    public ViewSourceQueryTests()
    {
        _crews = new DatasetSource
        {
            Id = 2, DatasetId = 1, SourceKind = "view", SchemaName = "view", SourceName = "12", Alias = "Crews", RlsMode = "none",
            ViewSql = _view.Sql!.Sql,
        };
        var crewCount = Measure(5, "Crew Count", new AggregateNode("count", new ColumnNode("Crews", "crew_code")));
        var parts = Parts(Tasks(), _crews, crewCount);
        _repo = Repo(NewDataset(), parts);
        // The repository describes the stored SQL of each view source into the snapshot's catalogue.
        _repo.Setup(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => Snapshot(parts) with
            {
                Columns = [.. Columns, new("view", "12", "crew_type_id", false, false, null, null, null, "int"),
                    new("view", "12", "crew_code", false, false, null, null, null, "nvarchar(20)")],
            });
        _repo.Setup(r => r.GetViewsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<long>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => new[] { _view });
        _runner.Setup(r => r.RunAsync(It.IsAny<CompiledQuery>(), It.IsAny<DatabaseConnection>(), TenantId, It.IsAny<CancellationToken>()))
            .Callback<CompiledQuery, DatabaseConnection, long, CancellationToken>((q, _, _, _) => _ran.Add(q))
            .ReturnsAsync(new QueryResult([], [], DateTime.UtcNow));
    }

    private static PreparedView CrewView(string sql = "SELECT c.crew_type_id, c.code AS crew_code FROM ref.CrewType AS c")
    {
        var (checkedSql, problems) = ViewSource.Prepare(sql, Grain, AnyTable);
        return new PreparedView(12, "Crew types", Grain, checkedSql, problems,
            [new ViewColumn("crew_type_id", "int"), new ViewColumn("crew_code", "nvarchar(20)")]);
    }

    [Fact]
    public async Task A_query_reads_the_view_as_a_derived_table_of_its_stored_sql()
    {
        await Query(new QueryRequest(1, ["Crews.crew_code"], ["Crew Count"]));

        _ran.Single().Sql.Should().Contain($"FROM ({_crews.ViewSql}) AS [Crews]");
    }

    [Fact]
    public async Task A_view_edited_since_it_was_added_is_still_read_as_it_was_approved()
    {
        _view = CrewView("SELECT c.crew_type_id, c.code AS crew_code FROM ref.CrewType AS c WHERE c.is_active = 1");

        await Query(new QueryRequest(1, ["Crews.crew_code"], ["Crew Count"]));

        _ran.Single().Sql.Should().NotContain("is_active").And.Contain($"FROM ({_crews.ViewSql}) AS [Crews]");
        _repo.Verify(r => r.GetViewsAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<IReadOnlyCollection<long>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_view_source_without_stored_sql_is_refused_until_a_modeller_updates_it()
    {
        _crews.ViewSql = null;

        var act = () => Query(new QueryRequest(1, ["Crews.crew_code"], ["Crew Count"]));

        (await act.Should().ThrowAsync<QueryException>().Where(e => e.Code == QueryErrors.ViewSourceNeedsUpdate))
            .Which.Message.Should().Contain("Crews");
        _ran.Should().BeEmpty();
    }

    [Fact]
    public async Task Only_administrators_see_row_previews()
    {
        var act = () => Preview(new SourcePreviewRequest("table", "core", "TaskDaily"), admin: false);

        await act.Should().ThrowAsync<QueryException>().Where(e => e.Code == QueryErrors.RowsHidden);
        _ran.Should().BeEmpty();
    }

    [Fact]
    public async Task A_table_preview_reads_the_catalogue_columns_of_that_table_only()
    {
        await Preview(new SourcePreviewRequest("table", "ref", "CrewType"));

        _ran.Single().Sql.Should().Be("SELECT TOP (@top) [crew_type_id], [code], [employee_count]\nFROM [ref].[CrewType] AS [preview]");
    }

    [Fact]
    public async Task A_view_preview_reads_the_checked_sql()
    {
        await Preview(new SourcePreviewRequest("view", "", "12"));

        _ran.Single().Sql.Should().Be($"SELECT TOP (@top) [crew_type_id], [crew_code]\nFROM ({_view.Sql!.Sql}) AS [preview]");
    }

    [Theory]
    [InlineData("table", "core", "NoSuchTable", QueryErrors.UnknownField)]
    [InlineData("view", "", "abc", QueryErrors.SourceNotContractCompliant)]
    [InlineData("function", "core", "TaskDaily", QueryErrors.UnknownField)]
    public async Task A_preview_of_something_that_is_not_there_is_refused(string kind, string schema, string name, string code)
    {
        var act = () => Preview(new SourcePreviewRequest(kind, schema, name));

        await act.Should().ThrowAsync<QueryException>().Where(e => e.Code == code);
        _ran.Should().BeEmpty();
    }

    private Task<QueryResult> Query(QueryRequest request)
        => new RunModelQueryHandler(_repo.Object, _runner.Object, _cache, User(admin: true), Mock.Of<IViewRunRecorder>())
            .Handle(new RunModelQueryCommand(request, TenantId), default);

    private Task<QueryResult> Preview(SourcePreviewRequest request, bool admin = true)
        => new PreviewSourceHandler(_repo.Object, _runner.Object, _cache, User(admin))
            .Handle(new PreviewSourceCommand(1, request, TenantId), default);

    private static ICurrentUserService User(bool admin)
    {
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.Roles).Returns(admin ? new[] { "admin" } : new[] { "planner" });
        user.Setup(u => u.PlantCodes).Returns(Array.Empty<int>());
        return user.Object;
    }
}
