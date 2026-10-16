using TWise.Tenant.Application.Features.DatabaseViews;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ViewSourceTests
{
    private static bool AnyTable(string schema, string table) => true;

    private const string Grain = "One row per well.";

    private static PreparedView Usable(long id = 12) => new(
        id, "Wells", Grain, ViewSource.Prepare("SELECT w.WellId, w.WellName FROM core.Wells AS w", Grain, AnyTable).Sql, [],
        [new ViewColumn("WellId", "int"), new ViewColumn("WellName", "nvarchar(50)")]);

    [Fact]
    public void A_compliant_view_is_printed_again_without_comments_or_a_useless_order_by()
    {
        var (sql, problems) = ViewSource.Prepare(
            "SELECT w.WellId, w.WellName AS [Well Name] FROM core.Wells AS w -- every well\nORDER BY w.WellName;", Grain, AnyTable);

        problems.Should().BeEmpty();
        sql!.Sql.Should().Contain("[Well Name]").And.NotContain("--").And.NotContain("every well").And.NotContain("ORDER BY").And.NotContain(";");
        ViewContract.Check(sql.Sql, Grain).Should().BeEmpty();
    }

    [Fact]
    public void A_create_view_statement_gives_its_select_only()
        => ViewSource.Prepare("CREATE VIEW dbo.vWells AS SELECT w.WellId FROM core.Wells w", Grain, AnyTable).Sql!.Sql
            .Should().StartWith("SELECT").And.NotContain("CREATE");

    [Fact]
    public void An_order_by_that_goes_with_top_is_kept()
        => ViewSource.Prepare("SELECT TOP 10 w.WellId FROM core.Wells w ORDER BY w.WellId DESC", Grain, AnyTable).Sql!.Sql
            .Should().Contain("ORDER BY");

    [Theory]
    [InlineData("SELECT * FROM core.Wells", Grain, "Rule 2:")]
    [InlineData("SELECT w.WellId FROM core.Wells w", null, "Rule 4:")]
    public void Contract_failures_are_listed_with_their_rule(string sql, string? description, string expected)
    {
        var (checkedSql, problems) = ViewSource.Prepare(sql, description, AnyTable);

        checkedSql.Should().BeNull();
        problems.Should().Contain(p => p.StartsWith(expected));
    }

    [Theory]
    [InlineData("WITH d AS (SELECT w.WellId FROM core.Wells w) SELECT d.WellId FROM d", "WITH")]
    [InlineData("SELECT w.WellId FROM core.Wells w OPTION (RECOMPILE)", "OPTION")]
    [InlineData("SELECT w.WellId FROM core.Wells w FOR JSON PATH", "FOR JSON")]
    [InlineData("SELECT r.a FROM OPENROWSET('SQLNCLI', 'Server=x;Trusted_Connection=yes;', 'SELECT 1 AS a') AS r", "OPENROWSET")]
    [InlineData("SELECT r.a FROM OPENQUERY(OtherServer, 'SELECT 1 AS a') AS r", "OPENQUERY")]
    [InlineData("SELECT w.WellId FROM Wells w", "schema")]
    public void Views_that_cannot_sit_inside_a_query_are_refused_with_a_reason(string sql, string mentioned)
    {
        ViewContract.Check(sql, Grain).Should().BeEmpty("the contract alone allows this view");

        var (checkedSql, problems) = ViewSource.Prepare(sql, Grain, AnyTable);

        checkedSql.Should().BeNull();
        problems.Should().ContainSingle().Which.Should().Contain(mentioned);
    }

    private static bool WellsOnly(string schema, string table)
        => string.Equals(schema, "core", StringComparison.OrdinalIgnoreCase) && string.Equals(table, "Wells", StringComparison.OrdinalIgnoreCase);

    [Theory]
    [InlineData("SELECT l.name FROM sys.sql_logins AS l", "sys.sql_logins")]
    [InlineData("SELECT s.session_id FROM sys.dm_exec_sessions AS s", "sys.dm_exec_sessions")]
    [InlineData("SELECT t.TABLE_NAME FROM INFORMATION_SCHEMA.TABLES AS t", "INFORMATION_SCHEMA.TABLES")]
    [InlineData("SELECT w.WellId FROM core.Wells AS w WHERE w.WellId IN (SELECT p.principal_id FROM SYS.database_principals AS p)", "SYS.database_principals")]
    public void A_view_that_reads_a_system_schema_is_refused(string sql, string mentioned)
    {
        var (checkedSql, problems) = ViewSource.Prepare(sql, Grain, (_, _) => true);

        checkedSql.Should().BeNull();
        problems.Should().ContainSingle().Which.Should().Contain(mentioned).And.Contain("system");
    }

    [Theory]
    [InlineData("SELECT q.a FROM dbo.ReadAnything() AS q", "dbo.ReadAnything")]
    [InlineData("SELECT s.value FROM STRING_SPLIT('a,b', ',') AS s", "STRING_SPLIT")]
    [InlineData("SELECT q.text FROM sys.dm_exec_sql_text(0x01) AS q", "dm_exec_sql_text")]
    [InlineData("SELECT j.[key] FROM OPENJSON('{}') AS j", "OPENJSON")]
    [InlineData("SELECT f.fn FROM sys.fn_helpcollations() AS f", "fn_helpcollations")]
    public void A_view_that_reads_rows_from_a_function_is_refused(string sql, string mentioned)
    {
        var (checkedSql, problems) = ViewSource.Prepare(sql, Grain, (_, _) => true);

        checkedSql.Should().BeNull();
        problems.Should().Contain(p => p.Contains(mentioned) && p.Contains("function"));
    }

    [Fact]
    public void A_view_may_read_only_tables_in_the_catalogue_of_its_connection()
    {
        ViewSource.Prepare("SELECT w.WellId FROM core.Wells AS w", Grain, WellsOnly).Problems.Should().BeEmpty();

        var (checkedSql, problems) = ViewSource.Prepare(
            "SELECT w.WellId FROM core.Wells AS w JOIN core.Secrets AS s ON s.WellId = w.WellId", Grain, WellsOnly);

        checkedSql.Should().BeNull();
        problems.Should().ContainSingle().Which.Should().Contain("core.Secrets").And.Contain("Sync");
    }

    [Fact]
    public void Column_problems_name_what_to_fix()
    {
        ViewSource.ColumnProblems([]).Should().ContainSingle().Which.Should().Contain("could not read the columns");
        ViewSource.ColumnProblems([new ViewColumn("Id", "int"), new ViewColumn("id", "int")])
            .Should().ContainSingle().Which.Should().Contain("More than one output column is called Id");
        ViewSource.ColumnProblems([new ViewColumn("", "int")]).Should().ContainSingle().Which.Should().Contain("has no name");
        ViewSource.ColumnProblems([new ViewColumn("Id", "int")]).Should().BeEmpty();
    }

    [Fact]
    public void Only_a_usable_view_has_catalogue_columns_keyed_by_its_id()
    {
        ViewSource.CatalogColumns(Usable()).Select(c => (c.Schema, c.Table, c.Column, c.DataType))
            .Should().Equal(("view", "12", "WellId", "int"), ("view", "12", "WellName", "nvarchar(50)"));
        ViewSource.CatalogColumns(Usable() with { Sql = null, Problems = ["Rule 4: no grain."] }).Should().BeEmpty();
    }

    [Fact]
    public void A_query_refuses_a_deleted_or_failing_view_and_gets_the_checked_sql_of_a_usable_one()
    {
        var usable = Usable();
        ViewSource.Require("Wells", "12", [usable]).Should().BeSameAs(usable.Sql);

        var deleted = () => ViewSource.Require("Wells", "13", [usable]);
        deleted.Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.SourceNotContractCompliant && e.Message.Contains("no longer exists"));

        var failing = () => ViewSource.Require("Wells", "12", [usable with { Sql = null, Problems = ["Rule 7: The view calls GETDATE()."] }]);
        failing.Should().Throw<QueryException>()
            .Where(e => e.Code == QueryErrors.SourceNotContractCompliant && e.Message.Contains("GETDATE()"));
    }

    [Fact]
    public void Ids_are_read_from_view_sources_only()
        => ViewSource.Ids([
                new DatasetSource { SourceKind = "table", SchemaName = "core", SourceName = "12" },
                new DatasetSource { SourceKind = "view", SchemaName = "view", SourceName = "12" },
                new DatasetSource { SourceKind = "view", SchemaName = "view", SourceName = "12" },
                new DatasetSource { SourceKind = "view", SchemaName = "view", SourceName = "x" },
            ]).Should().Equal(12L);
}
