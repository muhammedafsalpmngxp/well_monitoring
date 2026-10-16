using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TWise.Tenant.Application;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.DatabaseConnections;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.DTOs;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class DatasetChangeBehaviorTests
{
    [Fact]
    public async Task A_change_moves_its_dataset_to_a_new_version_even_when_it_is_refused()
    {
        var cache = NewCache();
        var behavior = new DatasetChangeBehavior<RemoveMeasureCommand, Result<DatasetDetailDto>>(cache);

        var result = await behavior.Handle(new RemoveMeasureCommand(1, 5, TenantId),
            () => Task.FromResult(Result<DatasetDetailDto>.NotFound("The measure is not part of this data model.")), default);

        result.IsNotFound.Should().BeTrue();
        cache.Version(TenantId, 1).Should().Be(1);
        cache.Version(TenantId, 2).Should().Be(0);
    }

    [Fact]
    public async Task A_change_that_throws_still_moves_the_version()
    {
        var cache = NewCache();
        var behavior = new DatasetChangeBehavior<UpdateDatasetCommand, Result<DatasetDetailDto>>(cache);

        var change = () => behavior.Handle(new UpdateDatasetCommand(1, new UpdateDatasetRequest("Renamed", null), TenantId, 7),
            () => throw new InvalidOperationException("The connection was lost."), default);

        await change.Should().ThrowAsync<InvalidOperationException>();
        cache.Version(TenantId, 1).Should().Be(1);
    }

    [Fact]
    public async Task A_read_leaves_the_version_alone()
    {
        var cache = NewCache();
        var behavior = new DatasetChangeBehavior<GetDatasetQuery, Result<DatasetDetailDto>>(cache);

        await behavior.Handle(new GetDatasetQuery(1, TenantId),
            () => Task.FromResult(Result<DatasetDetailDto>.NotFound("The data model does not exist.")), default);

        cache.Version(TenantId, 1).Should().Be(0);
    }

    [Fact]
    public async Task A_change_for_one_tenant_leaves_another_tenants_dataset_with_the_same_id_alone()
    {
        var cache = NewCache();
        var behavior = new DatasetChangeBehavior<RemoveMeasureCommand, Result<DatasetDetailDto>>(cache);

        await behavior.Handle(new RemoveMeasureCommand(1, 5, 3),
            () => Task.FromResult(Result<DatasetDetailDto>.NotFound("The measure is not part of this data model.")), default);

        cache.Version(3, 1).Should().Be(1);
        cache.Version(TenantId, 1).Should().Be(0);
    }

    [Fact]
    public async Task Changing_deleting_or_syncing_a_connection_moves_the_tenants_generation()
    {
        var cache = NewCache();

        await new DatasetChangeBehavior<UpdateDatabaseConnectionCommand, DatabaseConnectionDto?>(cache).Handle(
            new UpdateDatabaseConnectionCommand(4, null!, 7, TenantId), () => Task.FromResult<DatabaseConnectionDto?>(null), default);
        await new DatasetChangeBehavior<DeleteDatabaseConnectionCommand, bool>(cache).Handle(
            new DeleteDatabaseConnectionCommand(4, TenantId), () => Task.FromResult(true), default);
        await new DatasetChangeBehavior<SyncDatabaseSchemaCommand, DatabaseSchemaResponse?>(cache).Handle(
            new SyncDatabaseSchemaCommand(4, TenantId), () => Task.FromResult<DatabaseSchemaResponse?>(null), default);

        cache.Generation(TenantId).Should().Be(3);
        cache.Generation(3).Should().Be(0);
    }

    [Fact]
    public void The_application_registers_the_behaviour_for_dataset_changes()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddApplication();

        using var provider = services.BuildServiceProvider();

        provider.GetServices<IPipelineBehavior<AddSourceCommand, Result<DatasetDetailDto>>>()
            .Should().ContainSingle(b => b is DatasetChangeBehavior<AddSourceCommand, Result<DatasetDetailDto>>);
    }

    /// <summary>
    /// A new dataset request that writes (calculated columns, transforms, ...) and forgets
    /// IChangesDataset fails here. Reads are named ...Query; CreateDatasetCommand is left out
    /// because a new dataset has nothing cached.
    /// </summary>
    [Fact]
    public void Every_dataset_change_moves_the_version()
    {
        var changes = typeof(AddSourceCommand).Assembly.GetTypes()
            .Where(t => t.Namespace == typeof(AddSourceCommand).Namespace
                && (t.Name.EndsWith("Command") || t.Name.EndsWith("Request"))
                && t.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IRequest<>))
                && t != typeof(CreateDatasetCommand))
            .ToList();

        changes.Should().HaveCountGreaterThanOrEqualTo(11);
        changes.Where(t => !typeof(IChangesDataset).IsAssignableFrom(t)).Select(t => t.Name).Should().BeEmpty();
    }
}
