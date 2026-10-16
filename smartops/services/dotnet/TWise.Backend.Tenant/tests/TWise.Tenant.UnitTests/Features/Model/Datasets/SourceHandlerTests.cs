using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class SourceHandlerTests
{
    [Fact]
    public async Task Adding_a_table_reads_the_catalogue_of_the_datasets_own_connection()
    {
        var repo = Repo(NewDataset(), Parts());

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("core", "TaskDaily", "TaskDaily", "none", null), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.GetColumnsAsync(4, TenantId, It.Is<IReadOnlyCollection<string>>(t => t.Contains("TaskDaily")), It.IsAny<CancellationToken>()));
        repo.Verify(r => r.AddAsync(It.Is<DatasetSource>(s => s.SourceName == "TaskDaily" && s.RlsMode == "none"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Adding_an_unknown_table_is_refused()
    {
        var repo = Repo(NewDataset(), Parts());

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("core", "NoSuchTable", "x", "none", null), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetSource>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Changing_the_row_filter_to_plant_stores_the_catalogue_spelling()
    {
        var crews = Crews();
        var repo = Repo(NewDataset(), Parts(Tasks(), crews));

        var result = await new UpdateSourceHandler(repo.Object).Handle(
            new UpdateSourceCommand(1, 2, new UpdateSourceRequest("plant", "CODE"), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        crews.RlsMode.Should().Be("plant");
        crews.RlsPlantColumn.Should().Be("code");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Hiding_columns_stores_the_known_names_once_and_refuses_an_unknown_one()
    {
        var crews = Crews();
        var repo = Repo(NewDataset(), Parts(Tasks(), crews));

        var hidden = await new SetHiddenColumnsHandler(repo.Object).Handle(
            new SetHiddenColumnsCommand(1, 2, new HiddenColumnsRequest(["code", "CODE"]), TenantId), default);
        hidden.IsSuccess.Should().BeTrue();
        crews.HiddenColumns.Should().Be("[\"code\"]");
        DatasetRules.ReadHidden(crews.HiddenColumns).Should().Equal("code");

        var unknown = await new SetHiddenColumnsHandler(repo.Object).Handle(
            new SetHiddenColumnsCommand(1, 2, new HiddenColumnsRequest(["nope"]), TenantId), default);
        unknown.IsValidationError.Should().BeTrue();

        var shown = await new SetHiddenColumnsHandler(repo.Object).Handle(
            new SetHiddenColumnsCommand(1, 2, new HiddenColumnsRequest([]), TenantId), default);
        shown.IsSuccess.Should().BeTrue();
        crews.HiddenColumns.Should().BeNull();
    }

    [Fact]
    public async Task Naming_a_table_keeps_its_alias_and_refuses_a_name_another_table_has()
    {
        var tasks = Tasks();
        var crews = Crews();
        var repo = Repo(NewDataset(), Parts(tasks, crews));

        var named = await new SetSourceDetailsHandler(repo.Object).Handle(
            new SetSourceDetailsCommand(1, 2, new SourceDetailsRequest(" Crew types ", " Every crew kind "), TenantId), default);
        named.IsSuccess.Should().BeTrue();
        (crews.Caption, crews.Description).Should().Be(("Crew types", "Every crew kind"));
        crews.Alias.Should().NotBe("Crew types");

        var taken = await new SetSourceDetailsHandler(repo.Object).Handle(
            new SetSourceDetailsCommand(1, 1, new SourceDetailsRequest("crew TYPES", null), TenantId), default);
        taken.IsConflict.Should().BeTrue();

        var cleared = await new SetSourceDetailsHandler(repo.Object).Handle(
            new SetSourceDetailsCommand(1, 2, new SourceDetailsRequest("", ""), TenantId), default);
        cleared.IsSuccess.Should().BeTrue();
        (crews.Caption, crews.Description).Should().Be(((string?)null, (string?)null));
    }

    [Fact]
    public async Task Removing_a_table_a_measure_uses_is_refused()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), Measure(5, "Task Count", TaskCount)));

        var result = await new RemoveSourceHandler(repo.Object).Handle(new RemoveSourceCommand(1, 1, TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("Task Count");
        repo.Verify(r => r.RemoveSourceAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Removing_an_unused_table_removes_it_with_its_relationships()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews(), Measure(5, "Task Count", TaskCount)));

        var result = await new RemoveSourceHandler(repo.Object).Handle(new RemoveSourceCommand(1, 2, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.RemoveSourceAsync(1, 2, It.IsAny<CancellationToken>()), Times.Once);
    }

    // Reads CrewType and Project, which are joined only through TaskDaily.
    private static DatasetMeasure CrewsPerProject() => Measure(6, "Crews per project", new BinaryNode("/",
        new AggregateNode("count_distinct", new ColumnNode("CrewType", "code")),
        new AggregateNode("count_distinct", new ColumnNode("Project", "project_key"))));

    [Fact]
    public async Task Removing_the_middle_table_of_a_measures_join_path_is_refused()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), Projects(), TasksToCrews(), TasksToProjects(), CrewsPerProject()));

        var result = await new RemoveSourceHandler(repo.Object).Handle(new RemoveSourceCommand(1, 1, TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be("The measure \"Crews per project\" depends on this. Change or delete that measure first.");
        repo.Verify(r => r.RemoveSourceAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Removing_an_end_table_of_a_chain_no_measure_crosses_is_allowed()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), Projects(), TasksToCrews(), TasksToProjects(), Measure(5, "Task Count", TaskCount)));

        var result = await new RemoveSourceHandler(repo.Object).Handle(new RemoveSourceCommand(1, 3, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.RemoveSourceAsync(1, 3, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_relationship_added_while_the_table_is_removed_is_a_conflict()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews()));
        repo.Setup(r => r.RemoveSourceAsync(1, 2, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await new RemoveSourceHandler(repo.Object).Handle(new RemoveSourceCommand(1, 2, TenantId), default);

        result.IsConflict.Should().BeTrue();
    }

    [Fact]
    public async Task A_column_with_a_transform_cannot_become_the_plant_column()
    {
        var crews = Crews();
        var repo = Repo(NewDataset(), Parts(Tasks(), crews, Transform(30, "code", "trim", sourceId: 2)));

        var result = await new UpdateSourceHandler(repo.Object).Handle(
            new UpdateSourceCommand(1, 2, new UpdateSourceRequest("plant", "CODE"), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be(
            "CrewType.CODE has a transform, so it cannot decide who sees which rows. Remove its transform first, or choose another column.");
        crews.RlsMode.Should().Be("none");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_table_goes_with_its_calculated_columns_and_transforms_when_nothing_else_uses_them()
    {
        var minutes = new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(60));
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews(), Calculated(20, "Minutes", minutes), Transform(30, "task_code", "trim")));

        var result = await new RemoveSourceHandler(repo.Object).Handle(new RemoveSourceCommand(1, 1, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.RemoveSourceAsync(1, 1, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_table_of_another_database_on_the_server_is_read_from_its_connection_and_stored_with_it()
    {
        var repo = Repo(NewDataset(), Parts());
        repo.Setup(r => r.GetColumnsAsync(10005, TenantId, It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>())).ReturnsAsync(Columns);

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("ref", "CrewType", "Crews", "none", null, ConnectionId: 10005), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.GetColumnsAsync(10005, TenantId, It.Is<IReadOnlyCollection<string>>(t => t.Contains("CrewType")), It.IsAny<CancellationToken>()));
        repo.Verify(r => r.AddAsync(It.Is<DatasetSource>(s => s.ConnectionId == 10005), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task The_models_own_connection_named_in_the_request_is_stored_as_the_models_own()
    {
        var repo = Repo(NewDataset(), Parts());

        await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("ref", "CrewType", "Crews", "none", null, ConnectionId: 4), TenantId), default);

        repo.Verify(r => r.AddAsync(It.Is<DatasetSource>(s => s.ConnectionId == null), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("view", 10005, "Views can be added only from this data model's own database")]
    [InlineData("table", 99, "The database connection does not exist.")]
    public async Task A_view_of_another_database_or_an_unknown_connection_is_refused(string kind, long connectionId, string message)
    {
        var repo = Repo(NewDataset(), Parts());

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("ref", "7", "Crews", "none", null, kind, connectionId), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().StartWith(message);
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetSource>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_database_on_another_server_is_refused_naming_both_servers()
    {
        var repo = Repo(NewDataset(), Parts());
        repo.Setup(r => r.GetConnectionsAsync(TenantId, It.IsAny<CancellationToken>())).ReturnsAsync([
            TenantConnection(),
            new DatabaseConnection { Id = 7, TenantId = TenantId, ConnectionName = "Sales", DatabaseName = "Sales", Server = "10.0.0.9", Provider = "mssql" },
        ]);

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("ref", "CrewType", "Crews", "none", null, ConnectionId: 7), TenantId), default);

        result.ErrorMessage.Should().StartWith("Sales is on 10.0.0.9,1433 and this data model reads smartops_tenant_TNT-1000 on ,1433.");
    }

    [Fact]
    public async Task The_get_data_database_list_says_which_connections_the_model_can_read()
    {
        var repo = Repo(NewDataset(), Parts());
        var postgres = new DatabaseConnection { Id = 8, TenantId = TenantId, ConnectionName = "Lake", DatabaseName = "lake", Provider = "postgres" };
        repo.Setup(r => r.GetConnectionsAsync(TenantId, It.IsAny<CancellationToken>())).ReturnsAsync([TenantConnection(), postgres]);

        var result = await new ListSourceConnectionsHandler(repo.Object).Handle(new ListSourceConnectionsQuery(1, TenantId), default);

        result.Value.Should().Equal(
            new DatasetConnectionDto(4, "Tenant database", "smartops_tenant_TNT-1000"),
            new DatasetConnectionDto(8, "Lake", "lake", false, "lake is not an active SQL Server connection."));
    }
}
