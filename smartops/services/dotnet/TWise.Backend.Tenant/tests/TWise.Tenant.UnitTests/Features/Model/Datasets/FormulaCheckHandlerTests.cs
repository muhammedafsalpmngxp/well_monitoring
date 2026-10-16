using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class FormulaCheckHandlerTests
{
    private static readonly MeasureNode Minutes = new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(60));

    [Fact]
    public async Task A_valid_measure_passes_and_nothing_is_written()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));

        var result = await new CheckMeasureHandler(repo.Object).Handle(
            new CheckMeasureQuery(1, new CheckMeasureRequest("", Element(TaskCount), null), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Kind.Should().Be("number");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetMeasure>(), It.IsAny<CancellationToken>()), Times.Never);
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_measure_name_in_use_is_refused_except_by_the_measure_itself()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount)));

        var taken = await new CheckMeasureHandler(repo.Object).Handle(
            new CheckMeasureQuery(1, new CheckMeasureRequest("task count", Element(TaskCount), null), TenantId), default);
        var itself = await new CheckMeasureHandler(repo.Object).Handle(
            new CheckMeasureQuery(1, new CheckMeasureRequest("Task Count", Element(TaskCount), 5), TenantId), default);

        taken.IsConflict.Should().BeTrue();
        itself.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task A_measure_on_a_missing_column_gives_the_error_save_would_give()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));
        var wrong = new AggregateNode("sum", new ColumnNode("TaskDaily", "no_such_column"));

        var result = await new CheckMeasureHandler(repo.Object).Handle(
            new CheckMeasureQuery(1, new CheckMeasureRequest("Wrong", Element(wrong), null), TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Contain("no_such_column");
    }

    [Fact]
    public async Task A_valid_column_passes_with_its_kind_and_nothing_is_written()
    {
        var repo = Repo(NewDataset(), Parts(Tasks()));
        var family = new FunctionNode("left", [new ColumnNode("TaskDaily", "task_code"), new NumberNode(4)]);

        var number = await new CheckCalculatedColumnHandler(repo.Object).Handle(
            new CheckCalculatedColumnQuery(1, new CheckCalculatedColumnRequest(1, "Minutes", Element(Minutes), null), TenantId), default);
        var text = await new CheckCalculatedColumnHandler(repo.Object).Handle(
            new CheckCalculatedColumnQuery(1, new CheckCalculatedColumnRequest(1, "", Element(family), null), TenantId), default);

        number.Value!.Kind.Should().Be("number");
        text.Value!.Kind.Should().Be("text");
        repo.Verify(r => r.AddAsync(It.IsAny<DatasetCalculatedColumn>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_column_of_another_table_is_refused_as_save_refuses_it()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews()));
        var crewCode = new FunctionNode("upper", [new ColumnNode("CrewType", "code")]);

        var check = await new CheckCalculatedColumnHandler(repo.Object).Handle(
            new CheckCalculatedColumnQuery(1, new CheckCalculatedColumnRequest(1, "Crew", Element(crewCode), null), TenantId), default);
        var save = await new AddCalculatedColumnHandler(repo.Object).Handle(
            new AddCalculatedColumnCommand(1, new SaveCalculatedColumnRequest(1, "Crew", Element(crewCode)), TenantId), default);

        check.IsSuccess.Should().Be(save.IsSuccess);
        if (!save.IsSuccess) check.ErrorMessage.Should().Be(save.ErrorMessage);
    }

    [Fact]
    public async Task A_change_that_breaks_a_measure_is_refused_before_save()
    {
        var stored = Calculated(20, "Minutes", Minutes);
        var repo = Repo(NewDataset(), Parts(Tasks(), stored,
            Measure(5, "Total Minutes", new AggregateNode("sum", new ColumnNode("TaskDaily", "Minutes")))));

        var result = await new CheckCalculatedColumnHandler(repo.Object).Handle(
            new CheckCalculatedColumnQuery(1, new CheckCalculatedColumnRequest(0, "Mins", Element(Minutes), 20), TenantId), default);

        result.IsSuccess.Should().BeFalse();
        result.ErrorMessage.Should().Contain("Total Minutes");
    }
}
