using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class PublishHandlerTests
{
    [Fact]
    public async Task Publishing_stores_the_parts_and_leaves_no_draft_changes()
    {
        var dataset = NewDataset();
        var repo = Repo(dataset, Parts(Tasks(), Measure(5, "Task Count", TaskCount)));

        var result = await new PublishDatasetHandler(repo.Object).Handle(new PublishDatasetCommand(1, TenantId, 42), default);

        result.IsSuccess.Should().BeTrue();
        dataset.Status.Should().Be("published");
        dataset.PublishedBy.Should().Be(42);
        PublishedModel.Read(dataset.PublishedModel)!.Measures.Should().ContainSingle(m => m.Name == "Task Count");
        result.Value!.HasDraftChanges.Should().BeFalse();
        result.Value.PublishedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task A_measure_that_does_not_compile_blocks_publishing()
    {
        var dataset = NewDataset();
        var repo = Repo(dataset, Parts(Tasks(), Measure(5, "Broken", new AggregateNode("sum", new ColumnNode("TaskDaily", "gone")))));

        var result = await new PublishDatasetHandler(repo.Object).Handle(new PublishDatasetCommand(1, TenantId, 42), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().StartWith("Broken cannot be published");
        dataset.PublishedModel.Should().BeNull();
    }

    [Fact]
    public async Task An_edit_after_publishing_shows_as_a_draft_change()
    {
        var dataset = NewDataset();
        var measure = Measure(5, "Task Count", TaskCount);
        var parts = Parts(Tasks(), measure);
        dataset.PublishedModel = PublishedModel.From(parts).Write();
        measure.Name = "Tasks";

        DatasetDetailDto.From(dataset, parts).HasDraftChanges.Should().BeTrue();
    }

    [Fact]
    public void The_signature_ignores_row_ids_so_a_discarded_draft_has_nothing_to_publish()
    {
        var before = Parts(Tasks(), Crews(), TasksToCrews(), Home(Measure(5, "Task Count", TaskCount), 2));
        var crews = Crews(); crews.Id = 20;
        var link = TasksToCrews(); link.Id = 30; link.ToSourceId = 20;
        var moved = Measure(50, "Task Count", TaskCount); moved.HomeSourceId = 20;
        var after = Parts(Tasks(), crews, link, moved);

        PublishedModel.Signature(after).Should().Be(PublishedModel.Signature(before));
    }

    [Fact]
    public async Task Discarding_writes_the_published_version_back_and_needs_one()
    {
        var never = NewDataset();
        var repo = Repo(never, Parts(Tasks()));
        (await new DiscardDraftHandler(repo.Object).Handle(new DiscardDraftCommand(1, TenantId), default)).IsConflict.Should().BeTrue();

        var dataset = NewDataset();
        var published = PublishedModel.From(Parts(Tasks(), Measure(5, "Task Count", TaskCount)));
        dataset.PublishedModel = published.Write();
        repo = Repo(dataset, Parts(Tasks()));
        var result = await new DiscardDraftHandler(repo.Object).Handle(new DiscardDraftCommand(1, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.ReplacePartsAsync(1, It.Is<PublishedModel>(m => m.Measures.Single().Name == "Task Count"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_measure_is_placed_under_a_table_of_the_dataset_and_in_a_folder()
    {
        var measure = Measure(5, "Task Count", TaskCount);
        var repo = Repo(NewDataset(), Parts(Tasks(), measure));

        var placed = await new PlaceMeasureHandler(repo.Object).Handle(
            new PlaceMeasureCommand(1, 5, new MeasurePlacementRequest(1, "  KPIs "), TenantId), default);
        var elsewhere = await new PlaceMeasureHandler(repo.Object).Handle(
            new PlaceMeasureCommand(1, 5, new MeasurePlacementRequest(99, null), TenantId), default);

        placed.IsSuccess.Should().BeTrue();
        measure.HomeSourceId.Should().Be(1);
        measure.Folder.Should().Be("KPIs");
        elsewhere.IsValidationError.Should().BeTrue();
    }

    [Fact]
    public void A_snapshot_serves_the_published_parts_unless_the_draft_is_asked_for()
    {
        var draft = Parts(Tasks(), Measure(5, "Tasks", TaskCount));
        var snapshot = Snapshot(draft) with { Published = PublishedModel.From(Parts(Tasks(), Measure(5, "Task Count", TaskCount))) };

        snapshot.Serving(draft: false).Measures.Single().Name.Should().Be("Task Count");
        snapshot.Serving(draft: true).Measures.Single().Name.Should().Be("Tasks");
        Snapshot(draft).Serving(draft: false).Measures.Single().Name.Should().Be("Tasks");
    }

    private static DatasetMeasure Home(DatasetMeasure measure, long sourceId)
    {
        measure.HomeSourceId = sourceId;
        return measure;
    }
}
