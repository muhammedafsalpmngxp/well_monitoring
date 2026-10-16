using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class ViewSourceHandlerTests
{
    private static bool AnyTable(string schema, string table) => true;

    private const string Grain = "One row per crew type.";

    /// <summary>View 12 on connection 4. Without a grain it fails rule 4 and has no checked SQL.</summary>
    private static PreparedView CrewView(bool usable = true)
    {
        var (sql, problems) = ViewSource.Prepare(
            "SELECT c.crew_type_id, c.code AS crew_code, c.plant_code FROM ref.CrewType AS c", usable ? Grain : null, AnyTable);
        return new PreparedView(12, "Crew types", usable ? Grain : null, sql, problems, usable
            ? [new ViewColumn("crew_type_id", "int"), new ViewColumn("crew_code", "nvarchar(20)"), new ViewColumn("plant_code", "int")]
            : []);
    }

    private static DatasetSource CrewSource() => new()
    {
        Id = 2, DatasetId = 1, SourceKind = "view", SchemaName = "view", SourceName = "12", Alias = "Crews", RlsMode = "none",
        ViewSql = CrewView().Sql!.Sql,
    };

    /// <summary>Columns of the stored SQL of view 12, as the repository describes them.</summary>
    private static CatalogColumn[] StoredCrewColumns(params string[] names) => (names.Length == 0 ? ["crew_type_id", "crew_code", "plant_code"] : names)
        .Select(n => new CatalogColumn("view", "12", n, false, false, null, null, null, "int")).ToArray();

    private static Mock<IDatasetRepository> RepoWithView(DatasetParts parts, PreparedView view, CatalogColumn[]? stored = null)
    {
        var repo = Repo(NewDataset(), parts);
        repo.Setup(r => r.GetViewsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<long>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { view });
        repo.Setup(r => r.GetViewSourceColumnsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<DatasetSource>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(stored ?? StoredCrewColumns());
        return repo;
    }

    /// <summary>View 12 after an edit in View Builder: a filter added and plant_code gone.</summary>
    private static PreparedView EditedCrewView()
    {
        var (sql, problems) = ViewSource.Prepare("SELECT c.crew_type_id, c.code AS crew_code FROM ref.CrewType AS c WHERE c.is_active = 1", Grain, AnyTable);
        return new PreparedView(12, "Crew types", Grain, sql, problems, [new ViewColumn("crew_type_id", "int"), new ViewColumn("crew_code", "nvarchar(20)")]);
    }

    [Fact]
    public void A_view_source_stores_the_checked_sql_of_the_view_as_it_was_added()
        => DatasetRules.NewViewSource(1, new AddSourceRequest("view", "12", "Crews", "none", null, "view"), CrewView(), [])
            .Value!.ViewSql.Should().Be(CrewView().Sql!.Sql);

    [Fact]
    public void Adding_a_view_again_while_its_first_source_holds_older_sql_is_refused()
    {
        var result = DatasetRules.NewViewSource(1, new AddSourceRequest("view", "12", "Crews 2", "none", null, "view"), EditedCrewView(), [CrewSource()]);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("Crews");
    }

    [Fact]
    public async Task The_dataset_flags_a_view_source_whose_view_has_changed_since_it_was_added()
    {
        var repo = RepoWithView(Parts(Tasks(), CrewSource()), EditedCrewView());

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default);

        result.Value!.Sources.Select(s => s.ViewChanged).Should().Equal(false, true);
    }

    [Fact]
    public async Task The_dataset_does_not_flag_a_view_source_whose_view_is_unchanged()
    {
        var repo = RepoWithView(Parts(Tasks(), CrewSource()), CrewView());

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default);

        result.Value!.Sources.Should().OnlyContain(s => !s.ViewChanged);
    }

    [Fact]
    public async Task A_view_source_added_before_its_sql_was_stored_is_flagged()
    {
        var old = CrewSource();
        old.ViewSql = null;
        var repo = RepoWithView(Parts(Tasks(), old), CrewView());

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default);

        result.Value!.Sources.Single(s => s.Kind == "view").ViewChanged.Should().BeTrue();
    }

    [Fact]
    public async Task Updating_a_view_source_stores_the_checked_sql_of_the_view_as_it_is_now()
    {
        var crews = CrewSource();
        var repo = RepoWithView(Parts(Tasks(), crews), EditedCrewView());

        var result = await new RefreshViewSourceHandler(repo.Object).Handle(new RefreshViewSourceCommand(1, 2, TenantId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        crews.ViewSql.Should().Be(EditedCrewView().Sql!.Sql);
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Updating_a_view_source_to_a_view_that_no_longer_passes_is_refused()
    {
        var crews = CrewSource();
        var repo = RepoWithView(Parts(Tasks(), crews), CrewView(usable: false));

        var result = await new RefreshViewSourceHandler(repo.Object).Handle(new RefreshViewSourceCommand(1, 2, TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Contain("Rule 4:");
        crews.ViewSql.Should().Be(CrewView().Sql!.Sql);
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Updating_a_view_source_whose_view_lost_its_plant_column_is_refused()
    {
        var crews = CrewSource();
        crews.RlsMode = "plant";
        crews.RlsPlantColumn = "plant_code";
        var repo = RepoWithView(Parts(Tasks(), crews), EditedCrewView());

        var result = await new RefreshViewSourceHandler(repo.Object).Handle(new RefreshViewSourceCommand(1, 2, TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("plant_code");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Updating_a_view_source_that_would_break_a_measure_is_refused()
    {
        var plants = Measure(6, "Plant Count", new AggregateNode("count_distinct", new ColumnNode("Crews", "plant_code")));
        var repo = RepoWithView(Parts(Tasks(), CrewSource(), plants), EditedCrewView());

        var result = await new RefreshViewSourceHandler(repo.Object).Handle(new RefreshViewSourceCommand(1, 2, TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("Plant Count");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Only_a_view_source_can_be_updated_from_its_view()
    {
        var repo = RepoWithView(Parts(Tasks(), CrewSource()), CrewView());

        var result = await new RefreshViewSourceHandler(repo.Object).Handle(new RefreshViewSourceCommand(1, 1, TenantId), default);

        result.IsValidationError.Should().BeTrue();
    }

    [Fact]
    public void Updating_a_view_source_moves_the_cache_version_of_the_dataset()
        => new RefreshViewSourceCommand(1, 2, TenantId).Should().BeAssignableTo<IChangesDataset>();

    [Fact]
    public async Task The_plant_filter_of_a_view_source_is_checked_against_the_columns_of_its_stored_sql()
    {
        var crews = CrewSource();
        var repo = RepoWithView(Parts(Tasks(), crews), CrewView(), StoredCrewColumns("crew_type_id", "crew_code"));

        var result = await new UpdateSourceHandler(repo.Object).Handle(
            new UpdateSourceCommand(1, 2, new UpdateSourceRequest("plant", "plant_code"), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        crews.RlsMode.Should().Be("none");
    }

    [Fact]
    public void A_view_source_stores_the_view_id_and_filters_rows_by_a_column_of_the_view()
    {
        var result = DatasetRules.NewViewSource(1, new AddSourceRequest("view", "12", "Crews", "plant", "PLANT_CODE", "view"), CrewView(), []);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().BeEquivalentTo(new
            { SourceKind = "view", SchemaName = "view", SourceName = "12", Alias = "Crews", RlsMode = "plant", RlsPlantColumn = "plant_code" });
    }

    [Fact]
    public void A_view_that_fails_the_contract_is_refused_with_its_first_reason()
    {
        var result = DatasetRules.NewViewSource(1, new AddSourceRequest("view", "12", "Crews", "none", null, "view"), CrewView(usable: false), []);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().StartWith("The view Crew types cannot be added.").And.Contain("Rule 4:");
    }

    [Fact]
    public void A_view_that_is_not_on_the_connection_is_refused()
        => DatasetRules.NewViewSource(1, new AddSourceRequest("view", "99", "X", "none", null, "view"), null, [])
            .ErrorMessage.Should().Be("The view does not exist on this data model's connection.");

    [Fact]
    public async Task Adding_a_view_reads_that_view_on_the_datasets_connection_and_not_the_table_catalogue()
    {
        var repo = RepoWithView(Parts(Tasks()), CrewView());

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("view", "12", "Crews", "none", null, "view"), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.GetViewsAsync(4, TenantId, It.Is<IReadOnlyCollection<long>>(ids => ids.Single() == 12), It.IsAny<CancellationToken>()));
        repo.Verify(r => r.AddAsync(It.Is<DatasetSource>(s => s.SourceKind == "view" && s.SourceName == "12"), It.IsAny<CancellationToken>()), Times.Once);
        repo.Verify(r => r.GetColumnsAsync(It.IsAny<long>(), It.IsAny<long>(),
            It.Is<IReadOnlyCollection<string>>(t => t.Contains("12")), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task The_dataset_labels_a_view_by_its_name_and_a_table_by_schema_and_name()
    {
        var repo = RepoWithView(Parts(Tasks(), CrewSource()), CrewView());

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default);

        result.Value!.Sources.Select(s => (s.Kind, s.Label)).Should().Equal(("table", "core.TaskDaily"), ("view", "Crew types"));
    }

    [Fact]
    public async Task A_measure_on_a_view_column_is_checked_against_the_columns_of_the_view()
    {
        var repo = RepoWithView(Parts(Tasks(), CrewSource()), CrewView());
        var crewCount = new AggregateNode("count_distinct", new ColumnNode("Crews", "crew_code"));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Crew Count", Element(crewCount)), TenantId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        repo.Verify(r => r.AddAsync(It.Is<DatasetMeasure>(m => m.Name == "Crew Count"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Listing_views_returns_each_view_with_whether_it_can_be_added_and_why_not()
    {
        var repo = Repo(NewDataset(), Parts());
        repo.Setup(r => r.GetViewsAsync(4, TenantId, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { CrewView(), CrewView(usable: false) with { Id = 13, Name = "Old crews" } });

        var result = await new ListDatasetViewsHandler(repo.Object).Handle(new ListDatasetViewsQuery(1, TenantId), default);

        result.Value!.Select(v => (v.Id, v.Usable, v.Columns.Count)).Should().Equal((12L, true, 3), (13L, false, 0));
        result.Value![1].Problems.Should().ContainSingle(p => p.StartsWith("Rule 4:"));
    }

    [Theory]
    [InlineData("12", true)]
    [InlineData("crews", false)]
    public void A_view_is_named_by_its_id(string sourceName, bool valid)
        => new AddSourceCommandValidator()
            .Validate(new AddSourceCommand(1, new AddSourceRequest("view", sourceName, "Crews", "none", null, "view"), TenantId))
            .IsValid.Should().Be(valid);
}
