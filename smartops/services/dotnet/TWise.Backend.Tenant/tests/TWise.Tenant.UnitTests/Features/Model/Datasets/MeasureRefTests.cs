using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class MeasureRefTests
{
    private static readonly MeasureNode HoursPerTask =
        new BinaryNode("/", new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours")), new MeasureRefNode("Task Count"));

    [Fact]
    public void A_reference_prints_bracketed_and_expands_to_the_named_formula()
    {
        MeasureText.Print(HoursPerTask).Should().Be("SUM(TaskDaily.data_hours) / [Task Count]");

        var expanded = DatasetRules.ExpandRefs(HoursPerTask, "Hours per task", DatasetRules.MeasureLookup([Measure(5, "Task Count", TaskCount)]));

        expanded.Should().Be(new BinaryNode("/", new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours")), TaskCount));
    }

    [Fact]
    public void A_measure_that_reaches_itself_or_an_unknown_name_is_refused()
    {
        var loop = DatasetRules.MeasureLookup([Measure(5, "A", new MeasureRefNode("B")), Measure(6, "B", new MeasureRefNode("A"))]);

        var cycle = () => DatasetRules.ExpandRefs(new MeasureRefNode("B"), "A", loop);
        cycle.Should().Throw<QueryException>().WithMessage("A uses B uses A: a measure cannot use itself.");

        var unknown = () => DatasetRules.ExpandRefs(new MeasureRefNode("Nope"), "A", loop);
        unknown.Should().Throw<QueryException>().WithMessage("*no measure called Nope*");
    }

    [Fact]
    public async Task A_measure_can_use_another_and_that_one_cannot_be_deleted_while_it_does()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Measure(5, "Task Count", TaskCount), Measure(6, "Hours per task", HoursPerTask)));

        var check = await new AddMeasureHandler(repo.Object).Handle(
            new AddMeasureCommand(1, new SaveMeasureRequest("Tasks x 2", Element(new BinaryNode("*", new MeasureRefNode("Task Count"), new NumberNode(2)))), TenantId),
            default);
        check.IsSuccess.Should().BeTrue();

        var removed = await new RemoveMeasureHandler(repo.Object).Handle(new RemoveMeasureCommand(1, 5, TenantId), default);
        removed.IsConflict.Should().BeTrue();
        removed.ErrorMessage.Should().Contain("Hours per task uses [Task Count]");
        repo.Verify(r => r.DeleteAsync(It.IsAny<DatasetMeasure>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
