using System.Text.Json;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class CalculatedColumnHandlerTests
{
    private static readonly MeasureNode Minutes = new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(60));

    [Fact]
    public async Task Added_column_stores_its_tree_its_text_and_its_type()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var result = await new AddCalculatedColumnHandler(repo.Object).Handle(
            new AddCalculatedColumnCommand(1, new SaveCalculatedColumnRequest(1, " Minutes ", Element(Minutes)), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(
            It.Is<DatasetCalculatedColumn>(c => c.DatasetId == 1 && c.SourceId == 1 && c.Name == "Minutes" && c.ExpressionAst == Json(Minutes)
                && c.ExpressionText == "TaskDaily.data_hours * 60" && c.DataType == "number"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_formula_that_cannot_be_read_is_refused()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var result = await new AddCalculatedColumnHandler(repo.Object).Handle(
            new AddCalculatedColumnCommand(1, new SaveCalculatedColumnRequest(1, "Minutes", JsonDocument.Parse("{}").RootElement), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("Build the calculated column before saving it.");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetCalculatedColumn>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_table_of_another_dataset_is_refused()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var result = await new AddCalculatedColumnHandler(repo.Object).Handle(
            new AddCalculatedColumnCommand(1, new SaveCalculatedColumnRequest(99, "Minutes", Element(Minutes)), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("The table is not part of this data model.");
    }

    [Fact]
    public async Task Updated_column_replaces_its_name_tree_text_and_type()
    {
        var stored = Calculated(20, "Minutes", Minutes);
        var repo = Repo(NewDataset(), Parts(Tasks(), stored));
        var family = new FunctionNode("left", [new ColumnNode("TaskDaily", "task_code"), new NumberNode(4)]);

        var result = await new UpdateCalculatedColumnHandler(repo.Object).Handle(
            new UpdateCalculatedColumnCommand(1, 20, new UpdateCalculatedColumnRequest("Family", Element(family)), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        stored.Should().BeEquivalentTo(new
        {
            Id = 20L, Name = "Family", ExpressionAst = Json(family), ExpressionText = "LEFT(TaskDaily.task_code, 4)", DataType = "text",
        });
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Renaming_a_column_a_measure_uses_is_refused()
    {
        var stored = Calculated(20, "Minutes", Minutes);
        var repo = Repo(NewDataset(), Parts(Tasks(), stored,
            Measure(5, "Total Minutes", new AggregateNode("sum", new ColumnNode("TaskDaily", "Minutes")))));

        var result = await new UpdateCalculatedColumnHandler(repo.Object).Handle(
            new UpdateCalculatedColumnCommand(1, 20, new UpdateCalculatedColumnRequest("Mins", Element(Minutes)), TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be("The measure \"Total Minutes\" depends on this. Change or delete that measure first.");
        stored.Name.Should().Be("Minutes");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Removing_a_column_another_column_uses_is_refused()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Calculated(20, "Minutes", Minutes),
            Calculated(21, "Hours back", new BinaryNode("/", new ColumnNode("TaskDaily", "Minutes"), new NumberNode(60)))));

        var result = await new RemoveCalculatedColumnHandler(repo.Object).Handle(new RemoveCalculatedColumnCommand(1, 20, TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be("The calculated column \"TaskDaily.Hours back\" depends on this. Change or delete that column first.");
        repo.Verify(r => r.DeleteAsync(It.IsAny<DatasetCalculatedColumn>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_column_nothing_uses_is_removed()
    {
        var stored = Calculated(20, "Minutes", Minutes);
        var repo = Repo(NewDataset(), Parts(Tasks(), stored));

        var result = await new RemoveCalculatedColumnHandler(repo.Object).Handle(new RemoveCalculatedColumnCommand(1, 20, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(stored, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Updating_a_column_of_another_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Calculated(20, "Minutes", Minutes)));

        var result = await new UpdateCalculatedColumnHandler(repo.Object).Handle(
            new UpdateCalculatedColumnCommand(1, 99, new UpdateCalculatedColumnRequest("Minutes", Element(Minutes)), TenantId), default);

        result.IsNotFound.Should().BeTrue();
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task The_dataset_lists_its_calculated_columns_and_transforms()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Calculated(20, "Minutes", Minutes), Transform(30, "task_code", "null_fill", "none")));

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default);

        result.Value!.CalculatedColumns.Should().Equal(new CalculatedColumnDto(20, 1, "Minutes", "number", Minutes));
        result.Value!.Transforms.Should().Equal(new TransformDto(30, 1, "task_code", "null_fill", "none", 1));
    }
}
