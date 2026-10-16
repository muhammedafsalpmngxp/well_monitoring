using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class DatasetHandlerTests
{
    [Fact]
    public async Task Another_tenants_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts());

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, 999), default);

        result.IsNotFound.Should().BeTrue();
    }

    [Fact]
    public async Task Get_reads_the_dataset_once_until_it_changes()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount)));
        var cache = NewCache();
        var handler = new GetDatasetHandler(repo.Object, cache);

        var first = await handler.Handle(new GetDatasetQuery(1, TenantId), default);
        await handler.Handle(new GetDatasetQuery(1, TenantId), default);
        cache.Changed(TenantId, 1);
        await handler.Handle(new GetDatasetQuery(1, TenantId), default);

        first.Value!.Measures.Select(m => m.Name).Should().Equal("Task Count");
        first.Value!.Sources.Select(s => s.Alias).Should().Equal("TaskDaily");
        repo.Verify(r => r.GetSnapshotAsync(1, TenantId, It.IsAny<CancellationToken>()), Times.Exactly(2));
        repo.Verify(r => r.GetPartsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_refuses_a_connection_the_tenant_does_not_have()
    {
        var repo = new Mock<IDatasetRepository>();
        TenantConnections(repo, Connection(5, "smartops_tenant_TNT-1000"));

        var result = await new CreateDatasetHandler(repo.Object).Handle(new CreateDatasetCommand(new("Wells", null, 4), 2, 7), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("The database connection does not exist.");
        repo.Verify(r => r.AddAsync(It.IsAny<Dataset>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_accepts_a_sql_server_connection_to_another_database()
    {
        var repo = new Mock<IDatasetRepository>();
        TenantConnections(repo, Connection(4, "AlTasnimBI"));
        repo.Setup(r => r.GetPartsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync(Parts());

        var result = await new CreateDatasetHandler(repo.Object).Handle(new CreateDatasetCommand(new("Wells", null, 4), 2, 7), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(It.Is<Dataset>(d => d.ConnectionId == 4), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Create_refuses_a_connection_that_is_not_sql_server()
    {
        var repo = new Mock<IDatasetRepository>();
        TenantConnections(repo, Connection(4, "smartops_tenant_TNT-1000", "postgres"));

        var result = await new CreateDatasetHandler(repo.Object).Handle(new CreateDatasetCommand(new("Wells", null, 4), 2, 7), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("Data models can use active SQL Server connections only.");
        repo.Verify(r => r.AddAsync(It.IsAny<Dataset>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Connections_lists_only_active_sql_server_connections()
    {
        var repo = new Mock<IDatasetRepository>();
        var inactive = Connection(6, "smartops_tenant_TNT-1000");
        inactive.IsActive = false;
        TenantConnections(repo,
            Connection(4, "SMARTOPS_TENANT_TNT-1000", "MSSQL"), Connection(5, "AlTasnimBI"), inactive,
            Connection(7, "smartops_tenant_TNT-1000", "mysql"));

        var result = await new ListDatasetConnectionsHandler(repo.Object).Handle(new ListDatasetConnectionsQuery(2), default);

        result.Value.Should().Equal(
            new DatasetConnectionDto(4, "Connection 4", "SMARTOPS_TENANT_TNT-1000"), new DatasetConnectionDto(5, "Connection 5", "AlTasnimBI"));
    }

    [Fact]
    public async Task Connections_do_not_depend_on_knowing_the_tenant_database()
    {
        var repo = new Mock<IDatasetRepository>();
        TenantConnections(repo, Connection(4, "smartops_tenant_TNT-1000"));
        repo.Setup(r => r.TenantDatabaseName).Returns((string?)null);

        var result = await new ListDatasetConnectionsHandler(repo.Object).Handle(new ListDatasetConnectionsQuery(2), default);

        result.Value.Should().Equal(new DatasetConnectionDto(4, "Connection 4", "smartops_tenant_TNT-1000"));
    }

    [Fact]
    public async Task Create_refuses_a_name_already_used_in_the_tenant()
    {
        var repo = new Mock<IDatasetRepository>();
        TenantConnections(repo, Connection(4, "smartops_tenant_TNT-1000"));
        repo.Setup(r => r.NameTakenAsync(2, "Slice check", It.IsAny<long?>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var result = await new CreateDatasetHandler(repo.Object).Handle(new CreateDatasetCommand(new(" Slice check ", null, 4), 2, 7), default);

        result.IsConflict.Should().BeTrue();
        repo.Verify(r => r.AddAsync(It.IsAny<Dataset>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_stores_the_trimmed_name_with_tenant_and_author()
    {
        var repo = new Mock<IDatasetRepository>();
        TenantConnections(repo, Connection(4, "smartops_tenant_TNT-1000"));
        repo.Setup(r => r.GetPartsAsync(It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync(Parts());

        var result = await new CreateDatasetHandler(repo.Object).Handle(new CreateDatasetCommand(new("  Wells ", "   ", 4), 2, 7), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(
            It.Is<Dataset>(d => d.Name == "Wells" && d.Description == null && d.TenantId == 2 && d.ConnectionId == 4 && d.CreatedBy == 7),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Delete_is_soft()
    {
        var dataset = NewDataset();
        var repo = Repo(dataset, Parts());

        var result = await new DeleteDatasetHandler(repo.Object).Handle(new DeleteDatasetCommand(1, TenantId, 7), default);

        result.IsSuccess.Should().BeTrue();
        dataset.IsDeleted.Should().BeTrue();
        dataset.ModifiedBy.Should().Be(7);
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    private static DatabaseConnection Connection(long id, string database, string provider = "mssql") => new()
        { Id = id, TenantId = 2, ConnectionName = $"Connection {id}", DatabaseName = database, Provider = provider };

    /// <summary>Tenant 2 holds these connections, and the API's own database is smartops_tenant_TNT-1000.</summary>
    private static void TenantConnections(Mock<IDatasetRepository> repo, params DatabaseConnection[] connections)
    {
        repo.Setup(r => r.GetConnectionsAsync(2, It.IsAny<CancellationToken>())).ReturnsAsync(connections);
        repo.Setup(r => r.TenantDatabaseName).Returns("smartops_tenant_TNT-1000");
    }
}
