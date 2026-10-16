using TWise.Tenant.Application.Features.DatabaseViews;

namespace TWise.Tenant.UnitTests.Features.DatabaseViews;

public sealed class ViewContractTests
{
    private const string Grain = "One row per well per day.";

    private static int[] Rules(string sql, string? description = Grain)
        => ViewContract.Check(sql, description).Select(v => v.Rule).ToArray();

    [Theory]
    [InlineData("SELECT w.WellId, w.WellName AS [Well Name] FROM core.Wells w")]
    [InlineData("CREATE VIEW dbo.vWells AS SELECT w.WellId FROM core.Wells w")]
    [InlineData("WITH d AS (SELECT WellId, SUM(Qty) AS Qty FROM core.Daily GROUP BY WellId) SELECT d.WellId, d.Qty FROM d")]
    [InlineData("SELECT a.Id FROM core.A a UNION ALL SELECT b.Id FROM core.B b")]
    [InlineData("SELECT COUNT(*) AS Total FROM core.Wells")]
    [InlineData("SELECT w.WellId FROM core.Wells w WHERE w.Name = 'GETDATE() DECLARE @x'")]
    public void Compliant_view_has_no_violations(string sql)
        => Rules(sql).Should().BeEmpty();

    [Theory]
    [InlineData("DECLARE @from date = '2026-01-01'; SELECT w.WellId FROM core.Wells w WHERE w.D >= @from")]
    [InlineData("SELECT w.WellId FROM core.Wells w WHERE w.D >= @from")]
    [InlineData("SELECT w.WellId INTO #t FROM core.Wells w")]
    [InlineData("SELECT t.WellId FROM #t t")]
    [InlineData("SELECT 1 AS A; SELECT 2 AS B")]
    [InlineData("SELECT w.WellId FROM core.Wells w\nGO\nSELECT 1 AS A")]
    [InlineData("UPDATE core.Wells SET Name = 'x'")]
    [InlineData("SELEC oops")]
    public void Procedural_or_non_select_sql_breaks_rule_1(string sql)
        => Rules(sql).Should().Contain(1);

    [Theory]
    [InlineData("SELECT * FROM core.Wells")]
    [InlineData("SELECT w.* FROM core.Wells w")]
    [InlineData("SELECT w.Qty * 2 FROM core.Wells w")]
    public void Star_or_unnamed_column_breaks_rule_2(string sql)
        => Rules(sql).Should().Equal(2);

    [Fact]
    public void Three_part_name_breaks_rule_3_and_names_the_database()
    {
        var violations = ViewContract.Check("SELECT a.Id FROM AlTasnimBI.dbo.Assets a", Grain);

        violations.Should().ContainSingle().Which.Rule.Should().Be(3);
        violations[0].Message.Should().Contain("AlTasnimBI");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Wells with their names")]
    public void Missing_grain_breaks_rule_4(string? description)
        => Rules("SELECT w.WellId FROM core.Wells w", description).Should().Equal(4);

    [Theory]
    [InlineData("SELECT w.WellId, ROW_NUMBER() OVER (ORDER BY w.WellId) AS Rn FROM core.Wells w")]
    [InlineData("WITH d AS (SELECT Id FROM core.A) SELECT x.Id FROM d x JOIN d y ON x.Id = y.Id")]
    [InlineData("WITH r AS (SELECT Id FROM core.A UNION ALL SELECT a.Id FROM core.A a JOIN r ON r.Id = a.ParentId) SELECT r.Id FROM r")]
    public void Blocked_pushdown_breaks_rule_6(string sql)
        => Rules(sql).Should().Equal(6);

    [Fact]
    public void Window_function_inside_a_cte_is_allowed()
        => Rules("WITH d AS (SELECT Id, ROW_NUMBER() OVER (ORDER BY Id) AS Rn FROM core.A) SELECT d.Id, d.Rn FROM d")
            .Should().BeEmpty();

    [Theory]
    [InlineData("SELECT w.WellId, NEWID() AS Id FROM core.Wells w")]
    [InlineData("SELECT w.WellId FROM core.Wells w WHERE RAND() > 0.5")]
    public void Random_call_breaks_rule_7(string sql)
        => Rules(sql).Should().Equal(7);

    [Theory]
    [InlineData("SELECT w.WellId FROM core.Wells w WHERE w.D < GETDATE()")]
    [InlineData("SELECT w.WellId FROM core.Wells w WHERE w.D < CURRENT_TIMESTAMP")]
    [InlineData("SELECT w.WellId, CAST(SYSDATETIME() AS date) AS Today FROM core.Wells w")]
    public void Reading_today_is_allowed(string sql)
        => Rules(sql).Should().BeEmpty();

    [Fact]
    public void Violations_are_ordered_by_rule_and_not_repeated()
        => Rules("SELECT *, NEWID(), NEWID() FROM X.dbo.T", null)
            .Should().Equal(2, 2, 3, 4, 7);
}
