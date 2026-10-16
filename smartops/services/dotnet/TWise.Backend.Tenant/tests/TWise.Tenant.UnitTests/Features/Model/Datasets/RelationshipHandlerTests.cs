using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class RelationshipHandlerTests
{
    [Fact]
    public async Task Accepting_a_suggestion_stores_it_as_detected_from_a_foreign_key()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews()));

        var result = await new AddRelationshipHandler(repo.Object).Handle(new AddRelationshipCommand(1,
            new AddRelationshipRequest(1, "crew_type_id", 2, "crew_type_id", "many_to_one", "fk"), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.AddAsync(
            It.Is<DatasetRelationship>(x => x.FromSourceId == 1 && x.ToSourceId == 2 && x.DetectedFrom == "fk" && x.DatasetId == 1),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Suggestions_leave_out_relationships_already_added()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews()));

        var result = await new GetRelationshipSuggestionsHandler(repo.Object, NewCache()).Handle(new GetRelationshipSuggestionsQuery(1, TenantId), default);

        result.Value.Should().BeEmpty();
    }

    [Fact]
    public async Task A_relationship_outside_the_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews()));

        var result = await new UpdateRelationshipHandler(repo.Object).Handle(
            new UpdateRelationshipCommand(1, 10, new UpdateRelationshipRequest("one_to_one"), TenantId), default);

        result.IsNotFound.Should().BeTrue();
    }

    // Hours per crew reads both tables, so it needs the TaskDaily to CrewType join.
    private static DatasetMeasure HoursPerCrew() => Measure(6, "Hours per crew", new BinaryNode("/",
        new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours")),
        new AggregateNode("count_distinct", new ColumnNode("CrewType", "code"))));

    // A sum over CrewType double-counts once the join fans out from CrewType to TaskDaily.
    private static DatasetMeasure CrewSize() => Measure(7, "Crew size", new BinaryNode("/",
        new AggregateNode("sum", new ColumnNode("CrewType", "employee_count")),
        new AggregateNode("count", new ColumnNode("TaskDaily", "task_daily_id"))));

    private static DatasetRelationship OneToOne()
    {
        var relationship = TasksToCrews();
        relationship.Cardinality = "one_to_one";
        return relationship;
    }

    [Fact]
    public async Task Removing_the_join_a_measure_needs_is_refused()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews(), HoursPerCrew()));

        var result = await new RemoveRelationshipHandler(repo.Object).Handle(new RemoveRelationshipCommand(1, 10, TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be("The measure \"Hours per crew\" depends on this. Change or delete that measure first.");
        repo.Verify(r => r.DeleteAsync(It.IsAny<DatasetRelationship>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Removing_a_join_no_measure_needs_removes_it()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews(), Measure(5, "Task Count", TaskCount)));

        var result = await new RemoveRelationshipHandler(repo.Object).Handle(new RemoveRelationshipCommand(1, 10, TenantId), default);

        result.IsSuccess.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(It.Is<DatasetRelationship>(x => x.Id == 10), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_measure_that_was_already_broken_does_not_block_a_change()
    {
        var broken = Measure(8, "Old hours", new AggregateNode("sum", new ColumnNode("TaskDaily", "hours")));
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), TasksToCrews(), broken));

        var result = await new RemoveRelationshipHandler(repo.Object).Handle(new RemoveRelationshipCommand(1, 10, TenantId), default);

        result.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task Changing_one_to_one_to_many_to_one_under_a_sum_is_refused()
    {
        var relationship = OneToOne();
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), relationship, CrewSize()));

        var result = await new UpdateRelationshipHandler(repo.Object).Handle(
            new UpdateRelationshipCommand(1, 10, new UpdateRelationshipRequest("many_to_one"), TenantId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("Crew size");
        relationship.Cardinality.Should().Be("one_to_one");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Changing_cardinality_no_measure_depends_on_is_saved()
    {
        var relationship = OneToOne();
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews(), relationship, Measure(5, "Task Count", TaskCount)));

        var result = await new UpdateRelationshipHandler(repo.Object).Handle(
            new UpdateRelationshipCommand(1, 10, new UpdateRelationshipRequest("many_to_one"), TenantId), default);

        result.IsSuccess.Should().BeTrue();
        relationship.Cardinality.Should().Be("many_to_one");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Removing_a_relationship_of_another_dataset_is_not_found()
    {
        var repo = Repo(NewDataset(), Parts(Tasks(), Crews()));

        var result = await new RemoveRelationshipHandler(repo.Object).Handle(new RemoveRelationshipCommand(1, 10, TenantId), default);

        result.IsNotFound.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(It.IsAny<DatasetRelationship>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
