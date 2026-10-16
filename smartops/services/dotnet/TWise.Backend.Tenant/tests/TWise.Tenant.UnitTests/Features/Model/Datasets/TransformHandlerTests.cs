using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class TransformHandlerTests
{
    [Fact]
    public async Task A_fill_is_stored_after_the_tables_other_transforms_with_its_value()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Transform(30, "task_code", "trim")));

        var result = await new AddTransformHandler(repo.Object).Handle(
            new AddTransformCommand(1, new AddTransformRequest(1, "task_assignee", "null_fill", "Unassigned"), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(
            It.Is<DatasetTransform>(t => t.DatasetId == 1 && t.SourceId == 1 && t.ColumnName == "task_assignee" && t.Kind == "null_fill"
                && t.ConfigJson == """{"value":"Unassigned"}""" && t.SortOrder == 2),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_transform_of_the_plant_column_is_refused()
    {
        var crews = Crews();
        crews.RlsMode = "plant";
        crews.RlsPlantColumn = "code";
        var repo = Repo(NewDataset(), Parts(Tasks(), crews));

        var result = await new AddTransformHandler(repo.Object).Handle(
            new AddTransformCommand(1, new AddTransformRequest(2, "code", "null_fill", "X"), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("CrewType.code decides who sees which rows, so a transform cannot change it.");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetTransform>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_transform_is_removed()
    {
        var stored = Transform(30, "task_code", "trim");
        var repo = Repo(NewDataset(), Parts(Tasks(), stored));

        var result = await new RemoveTransformHandler(repo.Object).Handle(new RemoveTransformCommand(1, 30, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(stored, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Removing_a_transform_of_another_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Transform(30, "task_code", "trim")));

        var result = await new RemoveTransformHandler(repo.Object).Handle(new RemoveTransformCommand(1, 99, TenantId), default);

        result.IsNotFound.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(It.IsAny<DatasetTransform>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
