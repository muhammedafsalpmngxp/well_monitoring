using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ModelSnapshotTests
{
    [Fact]
    public void The_model_has_the_active_relationships_and_only_the_measures_asked_for()
    {
        var inactive = TasksToProjects();
        inactive.IsActive = false;
        var hours = new AggregateNode("sum", new ColumnNode("TaskDaily", "data_hours"));
        var snapshot = Snapshot(Parts(Tasks(), Crews(), Projects(), TasksToCrews(), inactive,
            Measure(5, "Task Count", TaskCount), Measure(6, "Hours", hours)));

        var model = snapshot.Model(["task count"]);

        model.Sources.Select(s => s.Alias).Should().Equal("TaskDaily", "CrewType", "Project");
        model.Relationships.Select(r => r.Id).Should().Equal(10);
        model.Measures.Select(m => m.Name).Should().Equal("Task Count");
    }

    [Fact]
    public void A_refreshed_view_column_takes_the_draft_type_in_a_draft_query_and_the_published_type_in_a_published_one()
    {
        // well_master.ipm turned from text into bit; the view source was refreshed in the draft to return text again.
        var draft = new CatalogColumn("view", "20346", "ipm", false, false, null, null, null, "varchar");
        var published = draft with { DataType = "bit" };
        var snapshot = Snapshot(Parts(Tasks())) with
        {
            Columns = [draft],
            PublishedColumns = [published],
            Published = PublishedModel.From(Parts(Tasks())),
        };

        snapshot.Serving(true).Catalog().DataType("view", "20346", "ipm").Should().Be("varchar");
        snapshot.Serving(false).Catalog().DataType("view", "20346", "ipm").Should().Be("bit");
    }

    [Fact]
    public void Only_an_unreadable_measure_that_is_asked_for_is_refused()
    {
        var broken = new DatasetMeasure { Id = 7, DatasetId = 1, Name = "Broken", ExpressionAst = "{}" };
        var snapshot = Snapshot(Parts(Tasks(), Measure(5, "Task Count", TaskCount), broken));

        snapshot.Model(["Task Count"]).Measures.Should().ContainSingle();
        var refused = () => snapshot.Model(["Broken"]);
        refused.Should().Throw<QueryException>().Which.Code.Should().Be(QueryErrors.InvalidMeasure);
    }

    [Fact]
    public void The_model_carries_calculated_columns_and_transforms_in_the_order_they_apply()
    {
        var minutes = new BinaryNode("*", new ColumnNode("TaskDaily", "data_hours"), new NumberNode(60));
        var unreadable = new DatasetCalculatedColumn { Id = 21, DatasetId = 1, SourceId = 1, Name = "Broken", ExpressionAst = "{}", DataType = "number" };
        var snapshot = Snapshot(Parts(Tasks(), Calculated(20, "Minutes", minutes), unreadable,
            Transform(31, "task_code", "null_fill", "none", sortOrder: 2), Transform(30, "task_code", "trim", sortOrder: 1)));

        var model = snapshot.Model([]);

        model.CalculatedColumns.Should().Equal(new ModelCalculatedColumn(1, "Minutes", minutes), new ModelCalculatedColumn(1, "Broken", null));
        model.Transforms.Should().Equal(new ModelTransform(1, "task_code", "trim"), new ModelTransform(1, "task_code", "null_fill", "none"));
    }

    [Fact]
    public void A_field_value_becomes_an_aggregate_under_its_name_and_a_bad_one_is_refused()
    {
        var snapshot = Snapshot(Parts(Tasks(), Measure(5, "Task Count", TaskCount)));

        var model = snapshot.Model(["Average of data_hours"], [new FieldValue("Average of data_hours", "TaskDaily.data_hours", "avg")]);
        model.Measures.Should().Equal(new ModelMeasure("Average of data_hours", new AggregateNode("avg", new ColumnNode("TaskDaily", "data_hours"))));

        var clash = () => snapshot.Model([], [new FieldValue("Task Count", "TaskDaily.task_daily_id", "count")]);
        clash.Should().Throw<QueryException>();
        var badFn = () => snapshot.Model([], [new FieldValue("X", "TaskDaily.data_hours", "median")]);
        badFn.Should().Throw<QueryException>();
        var badField = () => snapshot.Model([], [new FieldValue("X", "data_hours", "sum")]);
        badField.Should().Throw<QueryException>();
    }

    [Fact]
    public void A_table_of_another_database_is_compiled_with_its_database_and_a_lost_connection_is_refused()
    {
        var crews = Crews();
        crews.ConnectionId = 10005;
        var other = new DatabaseConnection { Id = 10005, TenantId = TenantId, ConnectionName = "BI", DatabaseName = "AlTasnimBI", Provider = "mssql" };
        var snapshot = Snapshot(Parts(Tasks(), crews)) with { Connections = [TenantConnection(), other] };

        snapshot.Model([]).Sources.Select(s => s.Database).Should().Equal(null, "AlTasnimBI");

        var lost = () => (snapshot with { Connections = [TenantConnection()] }).Model([]);
        lost.Should().Throw<QueryException>().WithMessage("CrewType reads a database connection that no longer exists.");
        other.Server = "10.0.0.9";
        var moved = () => snapshot.Model([]);
        moved.Should().Throw<QueryException>().WithMessage("CrewType cannot be read. AlTasnimBI is on 10.0.0.9,1433*");
    }
}
