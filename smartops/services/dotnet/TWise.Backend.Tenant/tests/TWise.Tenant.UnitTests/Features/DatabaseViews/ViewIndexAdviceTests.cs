using TWise.Tenant.Application.Features.DatabaseViews;

namespace TWise.Tenant.UnitTests.Features.DatabaseViews;

public sealed class ViewIndexAdviceTests
{
    private static ViewTableUsage Table(IReadOnlyList<ViewTableUsage> usages, string name)
        => usages.Single(u => u.Table == name);

    [Fact]
    public void Finds_filter_join_and_sort_columns_per_table()
    {
        var usages = ViewIndexAnalysis.Analyze("""
            SELECT w.WellId, SUM(d.Qty) AS Qty
            FROM well.well_master w
            JOIN dbo.task_daily d ON d.well_id = w.WellId
            WHERE w.cluster_code = 3 AND d.ActionOn >= '2026-01-01' AND d.status IN ('A', 'B')
            GROUP BY w.WellId
            ORDER BY w.WellId
            """)!;

        usages.Should().HaveCount(2);
        var wells = Table(usages, "well_master");
        wells.Schema.Should().Be("well");
        wells.EqualityColumns.Should().Equal("cluster_code");
        wells.JoinColumns.Should().Equal("WellId");
        wells.SortColumns.Should().Equal("WellId");
        var daily = Table(usages, "task_daily");
        daily.EqualityColumns.Should().Equal("status");
        daily.RangeColumns.Should().Equal("ActionOn");
        daily.JoinColumns.Should().Equal("well_id");
    }

    [Fact]
    public void Skips_ctes_temp_tables_and_wrapped_columns()
    {
        var usages = ViewIndexAnalysis.Analyze("""
            WITH Latest AS (SELECT t.well_id FROM dbo.task_daily t WHERE LTRIM(t.code) = 'X' AND t.Kind = 'A')
            SELECT l.well_id FROM Latest l JOIN #scratch s ON s.id = l.well_id
            """)!;

        usages.Should().ContainSingle();
        var daily = usages[0];
        daily.Table.Should().Be("task_daily");
        daily.EqualityColumns.Should().Equal("Kind");   // LTRIM(code) cannot use an index
    }

    [Fact]
    public void Reads_three_part_names_and_unqualified_columns_of_a_single_table()
    {
        var usages = ViewIndexAnalysis.Analyze(
            "SELECT well_id FROM [AlTasnimBI].[well].[wmr_conversion] WHERE time_stamp BETWEEN '2026-01-01' AND '2026-02-01'")!;

        var table = usages.Should().ContainSingle().Subject;
        table.Database.Should().Be("AlTasnimBI");
        table.RangeColumns.Should().Equal("time_stamp");
    }

    [Fact]
    public void Leading_wildcard_like_is_not_index_usable()
    {
        var table = ViewIndexAnalysis.Analyze("SELECT e.code FROM core.engineering_task_plan e WHERE e.code LIKE 'ENG1120-%' AND e.attributes LIKE '%FL%'")!.Single();
        table.RangeColumns.Should().Equal("code");
    }

    [Fact]
    public void Unparseable_sql_returns_null()
        => ViewIndexAnalysis.Analyze("SELECT a FROM WHERE (").Should().BeNull();

    [Fact]
    public void Suggests_filter_and_join_indexes_and_marks_existing_ones()
    {
        var usage = Table(ViewIndexAnalysis.Analyze(
            "SELECT d.Qty FROM dbo.task_daily d JOIN dbo.wells w ON w.Id = d.well_id WHERE d.status = 'A' AND d.ActionOn >= '2026-01-01'")!,
            "task_daily");
        var existing = new[] { new ExistingIndexInfo("PK_task_daily", "CLUSTERED", true, true, ["id"], []) };

        var advice = ViewIndexAdvisor.Advise(usage, "[dbo].[task_daily]", 1000, existing, []);

        advice.ExistingIndexes.Single().SupportsView.Should().BeFalse();
        advice.SuggestedIndexes.Select(s => string.Join(",", s.KeyColumns)).Should().Equal("status,ActionOn", "well_id");
        advice.SuggestedIndexes[0].CreateSql.Should()
            .Be("CREATE NONCLUSTERED INDEX [IX_task_daily_status_ActionOn] ON [dbo].[task_daily] ([status], [ActionOn]);");
    }

    [Fact]
    public void No_suggestion_when_an_index_already_leads_with_the_columns()
    {
        var usage = Table(ViewIndexAnalysis.Analyze(
            "SELECT d.Qty FROM dbo.task_daily d WHERE d.project_id = 1 AND d.status = 'A' AND d.ActionOn >= '2026-01-01'")!,
            "task_daily");
        // Same equality columns in a different order, then the range column: still covers the filter.
        var existing = new[] { new ExistingIndexInfo("IX_daily", "NONCLUSTERED", false, false, ["status", "project_id", "ActionOn", "id"], []) };

        var advice = ViewIndexAdvisor.Advise(usage, "[dbo].[task_daily]", null, existing, []);

        advice.SuggestedIndexes.Should().BeEmpty();
        advice.ExistingIndexes.Single().SupportsView.Should().BeTrue();
    }

    [Fact]
    public void Adds_sql_server_missing_index_rows_without_duplicates()
    {
        var usage = Table(ViewIndexAnalysis.Analyze(
            "SELECT d.Qty FROM dbo.task_daily d WHERE d.status = 'A' AND d.well_id = 5")!, "task_daily");
        var missing = new[]
        {
            new MissingIndexInfo(["status", "well_id"], [], [], 40),         // same as the view's filter index
            new MissingIndexInfo(["schedule_id"], [], [], 95),               // a column this view never uses
            new MissingIndexInfo(["schedule_id", "status"], [], [], 90),     // leads with a column this view never uses
            new MissingIndexInfo(["well_id"], ["ActionOn"], ["Qty"], 87.5),
            new MissingIndexInfo(["status"], ["ActionOn"], [], 10),          // past the top two
        };

        var advice = ViewIndexAdvisor.Advise(usage, "[dbo].[task_daily]", null, [], missing);

        advice.SuggestedIndexes.Should().HaveCount(2);
        var fromServer = advice.SuggestedIndexes.Single(s => s.Source == "SQL Server");
        fromServer.KeyColumns.Should().Equal("well_id", "ActionOn");
        fromServer.EstimatedImpact.Should().Be(87.5);
        fromServer.CreateSql.Should().EndWith("([well_id], [ActionOn]) INCLUDE ([Qty]);");
    }
}
