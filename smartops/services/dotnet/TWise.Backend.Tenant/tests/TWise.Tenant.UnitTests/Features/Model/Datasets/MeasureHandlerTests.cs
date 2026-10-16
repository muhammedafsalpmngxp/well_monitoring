using System.Text.Json;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class MeasureHandlerTests
{
    [Fact]
    public async Task Valid_measure_is_stored_as_normalised_json()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest(" Task Count ", Element(TaskCount)), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(
            It.Is<DatasetMeasure>(m => m.DatasetId == 1 && m.Name == "Task Count" && m.ExpressionAst == Json(TaskCount)),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Added_measure_stores_its_text_printed_from_the_tree()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));
        var worked = new AggregateNode("count", new ColumnNode("TaskDaily", "task_daily_id"),
            new MeasureCondition(new ColumnNode("TaskDaily", "data_hours"), "gt", "0"));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Worked Tasks", Element(worked)), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(
            It.Is<DatasetMeasure>(m => m.ExpressionAst == Json(worked)
                && m.ExpressionText == "COUNT(TaskDaily.task_daily_id WHERE TaskDaily.data_hours > 0)"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Updated_measure_replaces_its_tree_and_its_text()
    {
        var stored = Measure(5, "Task Count", TaskCount);
        var repo = Repo(NewDataset(), Parts(Tasks(), stored));
        var perTask = new BinaryNode("/", new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours")), TaskCount);

        var result = await new UpdateMeasureHandler(repo.Object).Handle(
            new UpdateMeasureCommand(1, 5, new SaveMeasureRequest("Hours per Task", Element(perTask)), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        stored.Name.Should().Be("Hours per Task");
        stored.ExpressionAst.Should().Be(Json(perTask));
        stored.ExpressionText.Should().Be("SUM(TaskDaily.data_hours) / COUNT(TaskDaily.task_daily_id)");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_name_already_used_in_any_case_is_a_conflict()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "task count", TaskCount)));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Task Count", Element(TaskCount)), TenantId), default);

        result.IsConflict.Should().BeTrue();
    }

    [Fact]
    public async Task Invalid_measure_is_refused_with_the_compilers_message()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));
        var missing = new AggregateNode("sum", new ColumnNode("TaskDaily", "no_such_column"));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Broken", Element(missing)), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("TaskDaily has no column called \"no_such_column\".");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetMeasure>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Sum_over_a_text_column_is_refused_before_it_is_stored()
    {
        var repo = Repo(NewDataset(), Parts(Crews()));
        // As on QA: employee_count is stored as varchar.
        var typed = Columns.Select(c => c.Column == "employee_count" ? c with { DataType = "varchar" } : c).ToList();
        repo.Setup(r => r.GetColumnsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(typed);
        var sum = new AggregateNode("sum", new ColumnNode("CrewType", "employee_count"));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Sum of CrewType.employee_count", Element(sum)), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("Sum needs a number column, but CrewType.employee_count holds text.");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetMeasure>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("""{"fn":"count","arg":{"source":"TaskDaily","column":"task_daily_id"}}""")]
    [InlineData("""{"kind":"bin","op":"+","left":{"value":1},"right":{"kind":"num","value":2}}""")]
    [InlineData("null")]
    public async Task An_expression_that_cannot_be_read_is_refused(string json)
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Task Count", JsonDocument.Parse(json).RootElement), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("Build the measure before saving it.");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetMeasure>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_missing_expression_is_refused_on_update()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount)));

        var result = await new UpdateMeasureHandler(repo.Object).Handle(
            new UpdateMeasureCommand(1, 5, new SaveMeasureRequest("Task Count", default), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Updating_a_measure_of_another_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount)));

        var result = await new UpdateMeasureHandler(repo.Object).Handle(
            new UpdateMeasureCommand(1, 99, new SaveMeasureRequest("Task Count", Element(TaskCount)), TenantId), default);

        result.IsNotFound.Should().BeTrue();
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Removing_a_measure_of_another_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount)));

        var result = await new RemoveMeasureHandler(repo.Object).Handle(new RemoveMeasureCommand(1, 99, TenantId), default);

        result.IsNotFound.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(It.IsAny<DatasetMeasure>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_measure_can_sum_a_calculated_column()
    {
        var minutes = new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(60));
        var repo = Repo(NewDataset(), Parts(Tasks(), Calculated(20, "Minutes", minutes)));
        var total = new AggregateNode("sum", new ColumnNode("TaskDaily", "Minutes"));

        var result = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Total Minutes", Element(total)), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(It.Is<DatasetMeasure>(m => m.ExpressionText == "SUM(TaskDaily.Minutes)"), It.IsAny<CancellationToken>()), Times.Once);
    }
}
