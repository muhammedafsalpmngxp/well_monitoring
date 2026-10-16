using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class JoinFinderTests
{
    private static readonly DatasetSource Tasks = new() { Id = 1, SourceKind = "table", SchemaName = "core", SourceName = "TaskDaily", Alias = "t" };
    private static readonly DatasetSource Crews = new() { Id = 2, SourceKind = "table", SchemaName = "ref", SourceName = "CrewType", Alias = "c" };

    private static CatalogColumn Column(string table, string schema, string name, string type)
        => new(schema, table, name, false, false, null, null, null, type);

    private static readonly CatalogColumn[] Columns =
    [
        Column("TaskDaily", "core", "task_daily_id", "int"), Column("TaskDaily", "core", "crew_type_id", "int"),
        Column("TaskDaily", "core", "source_system_id", "int"), Column("TaskDaily", "core", "created_at", "datetime2"),
        Column("CrewType", "ref", "crew_type_id", "int"), Column("CrewType", "ref", "source_system_id", "int"),
        Column("CrewType", "ref", "code", "varchar"), Column("CrewType", "ref", "created_at", "datetime2"),
    ];

    [Fact]
    public void Tables_sharing_a_key_like_column_are_candidates_and_system_columns_are_not()
    {
        var candidates = JoinFinder.Candidates([Tasks, Crews], Columns, [], []);

        candidates.Select(c => $"{c.A.Alias}.{c.AColumn}={c.B.Alias}.{c.BColumn}").Should().Equal("t.crew_type_id=c.crew_type_id");
    }

    [Fact]
    public void Tables_already_joined_or_suggested_are_left_alone()
    {
        var joined = new DatasetRelationship { FromSourceId = 1, FromColumn = "x", ToSourceId = 2, ToColumn = "y" };
        JoinFinder.Candidates([Tasks, Crews], Columns, [joined], []).Should().BeEmpty();
        JoinFinder.Candidates([Tasks, Crews], Columns, [], [new RelationshipSuggestionDto(2, "a", 1, "b", "many_to_one")]).Should().BeEmpty();
    }

    [Fact]
    public void The_unique_side_is_the_one_side_and_the_match_share_decides()
    {
        var candidate = new JoinCandidate(Tasks, "crew_type_id", Crews, "crew_type_id");

        JoinFinder.Suggest(candidate, new JoinProbe(4000, 40, 70, 70, 40, 38, 70, 45))
            .Should().Be(new RelationshipSuggestionDto(1, "crew_type_id", 2, "crew_type_id", "many_to_one", "data", 95));

        // Only the first table holds each value once: the join runs from the second to the first.
        JoinFinder.Suggest(candidate, new JoinProbe(70, 70, 4000, 40, 70, 45, 40, 40))!
            .Should().Match<RelationshipSuggestionDto>(s => s.FromSourceId == 2 && s.ToSourceId == 1 && s.MatchPercent == 100);

        JoinFinder.Suggest(candidate, new JoinProbe(50, 50, 50, 50, 50, 50, 50, 50))!.Cardinality.Should().Be("one_to_one");
        JoinFinder.Suggest(candidate, new JoinProbe(4000, 40, 70, 70, 40, 10, 70, 10)).Should().BeNull();
        JoinFinder.Suggest(candidate, new JoinProbe(4000, 40, 900, 70, 40, 40, 70, 40)).Should().BeNull();
    }

    [Fact]
    public void The_probe_names_a_table_of_another_database_with_its_database_and_the_others_as_before()
    {
        var sql = JoinFinder.ProbeSql(new JoinCandidate(Tasks, "crew_type_id", Crews, "crew_type_id", BDatabase: "AlTasnimBI"));

        sql.Should().Contain("(SELECT COUNT_BIG([crew_type_id]) FROM [core].[TaskDaily])")
            .And.Contain("(SELECT COUNT_BIG([crew_type_id]) FROM [AlTasnimBI].[ref].[CrewType])")
            .And.Contain("WHERE EXISTS (SELECT 1 FROM [AlTasnimBI].[ref].[CrewType] x WHERE x.[crew_type_id] = s.v)")
            .And.NotContain(" [ref].[CrewType]");
        JoinFinder.ProbeSql(new JoinCandidate(Tasks, "crew_type_id", Crews, "crew_type_id"))
            .Should().Contain("FROM [ref].[CrewType]").And.NotContain("AlTasnimBI");
    }

    [Fact]
    public void A_database_name_is_quoted_as_an_identifier()
        => JoinFinder.ProbeSql(new JoinCandidate(Tasks, "crew_type_id", Crews, "crew_type_id", "odd]db"))
            .Should().Contain("FROM [odd]]db].[core].[TaskDaily]");
}
