using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Imports;

public sealed class ImportTableSqlTests
{
    private static readonly ImportShape Typed = new(
        [
            new("Crew", "text"), new("Day", "date"), new("Start", "datetime"), new("Hours", "decimal"), new("Tasks", "whole"), new("Done", "boolean"),
        ],
        [["A1", new DateTime(2026, 9, 1), new DateTime(2026, 9, 1, 6, 0, 0), 8m, 3L, true]],
        [4]);

    [Fact]
    public void The_table_is_created_in_the_import_schema_with_typed_nullable_columns()
        => ImportRules.WriteTableSql("Crew_hours", Typed, replace: false).Should().Be("""
            CREATE TABLE [import].[Crew_hours] (
                [Crew] NVARCHAR(4000) NULL,
                [Day] DATE NULL,
                [Start] DATETIME2(3) NULL,
                [Hours] DECIMAL(38, 6) NULL,
                [Tasks] BIGINT NULL,
                [Done] BIT NULL
            );
            """.ReplaceLineEndings("\n"));

    [Fact]
    public void A_replace_drops_the_old_table_first_and_long_text_gets_a_max_column()
    {
        var shape = new ImportShape([new("Note]s", "text")], [[new string('x', 4001)]], [2]);

        ImportRules.WriteTableSql("Notes", shape, replace: true).Should().Be(
            "DROP TABLE IF EXISTS [import].[Notes];\nCREATE TABLE [import].[Notes] (\n    [Note]]s] NVARCHAR(MAX) NULL\n);");
    }

    [Fact]
    public void Catalogue_rows_look_like_a_schema_sync_wrote_them()
        => ImportRules.CatalogRows(Typed).Should().Equal(
            ("Crew", "nvarchar", 4000), ("Day", "date", null), ("Start", "datetime2", null),
            ("Hours", "decimal", null), ("Tasks", "bigint", null), ("Done", "bit", null));

    // A dataset over core.TaskDaily, ref.CrewType and an uploaded table, as a user would build it.
    private static readonly CatalogColumn[] Before =
    [
        .. Columns,
        new("import", "Crew_hours", "crew_type_id", false, false, null, null, null, "bigint"),
        new("import", "Crew_hours", "hours", false, false, null, null, null, "decimal"),
        new("import", "Crew_hours", "plant", false, false, null, null, null, "bigint"),
    ];

    private static DatasetSource Upload(string rlsMode = "none") => new()
    {
        Id = 5, DatasetId = 1, SourceKind = "table", SchemaName = "import", SourceName = "Crew_hours", Alias = "Hours",
        RlsMode = rlsMode, RlsPlantColumn = rlsMode == "plant" ? "plant" : null,
    };

    private static readonly DatasetRelationship UploadToCrews = new()
    {
        Id = 12, DatasetId = 1, FromSourceId = 5, FromColumn = "crew_type_id", ToSourceId = 2, ToColumn = "crew_type_id",
        Cardinality = "many_to_one", IsActive = true, DetectedFrom = "user",
    };

    private static readonly DatasetMeasure TotalHours = Measure(7, "Total Hours", new AggregateNode("sum", new ColumnNode("Hours", "hours")));

    private static CatalogColumn[] After(params (string Column, string Type)[] upload)
        => [.. Columns, .. upload.Select(u => new CatalogColumn("import", "Crew_hours", u.Column, false, false, null, null, null, u.Type))];

    [Fact]
    public void Replacing_with_the_same_columns_breaks_nothing()
        => ImportRules.ReplacementProblem("Crew check", Parts(Tasks(), Crews(), Upload(), UploadToCrews, TotalHours), Before,
                After(("crew_type_id", "bigint"), ("hours", "decimal"), ("plant", "bigint")), "Crew_hours")
            .Should().BeNull();

    [Fact]
    public void Losing_a_column_a_relationship_uses_is_named()
        => ImportRules.ReplacementProblem("Crew check", Parts(Tasks(), Crews(), Upload(), UploadToCrews), Before,
                After(("hours", "decimal"), ("plant", "bigint")), "Crew_hours")
            .Should().Be("The data model \"Crew check\" relates Hours on the column crew_type_id, which the new file does not have.");

    [Fact]
    public void Losing_the_plant_column_is_named()
        => ImportRules.ReplacementProblem("Crew check", Parts(Tasks(), Upload("plant")), Before,
                After(("crew_type_id", "bigint"), ("hours", "decimal")), "Crew_hours")
            .Should().Be("The data model \"Crew check\" filters Hours by the column plant, which the new file does not have.");

    [Fact]
    public void A_number_column_that_becomes_text_breaks_the_measure_that_sums_it()
        => ImportRules.ReplacementProblem("Crew check", Parts(Tasks(), Upload(), TotalHours), Before,
                After(("crew_type_id", "bigint"), ("hours", "nvarchar"), ("plant", "bigint")), "Crew_hours")
            .Should().StartWith("The measure \"Total Hours\" in the data model \"Crew check\" would stop working:");

    [Fact]
    public void A_number_column_that_becomes_text_breaks_the_calculated_column_that_uses_it()
        => ImportRules.ReplacementProblem("Crew check",
                Parts(Tasks(), Upload(), Calculated(20, "Minutes", new BinaryNode("*", new ColumnNode("Hours", "hours"), new NumberNode(60)), sourceId: 5)),
                Before, After(("crew_type_id", "bigint"), ("hours", "nvarchar"), ("plant", "bigint")), "Crew_hours")
            .Should().StartWith("The calculated column \"Hours.Minutes\" in the data model \"Crew check\" would stop working.");
}
