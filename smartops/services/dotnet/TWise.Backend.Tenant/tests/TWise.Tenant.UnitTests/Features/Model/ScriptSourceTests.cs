using TWise.Tenant.Application.Features.Model.Datasets;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ScriptSourceTests
{
    private const string Database = "AlTasnimBI";

    /// <summary>The tables view 10117 reads, as the connection's catalogue lists them.</summary>
    private static readonly HashSet<string> Tables10117 = new(StringComparer.OrdinalIgnoreCase)
        { "well.well_master", "ref.cluster", "dbo.plant_description", "well.well_progress", "well.well_completion_type", "dsq.drilling_sequence" };

    private static bool AnyTable(string schema, string table) => true;

    private static IReadOnlyList<string> Check(string sql) => ScriptSource.Check(sql, Database, AnyTable);

    /// <summary>View 10117 as View Builder saved it on QA: DECLAREs, then WITH ... SELECT ... ORDER BY.</summary>
    internal static string View10117()
        => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Features", "Model", "Data", "saved-view-10117.sql"));

    [Fact]
    public void A_saved_view_of_declares_and_one_final_select_runs_as_written()
        => ScriptSource.Check(View10117(), Database, (schema, table) => Tables10117.Contains($"{schema}.{table}")).Should().BeEmpty();

    [Fact]
    public void A_saved_view_that_reads_a_table_the_connection_does_not_list_is_refused()
        => ScriptSource.Check(View10117(), Database, (schema, table) => Tables10117.Contains($"{schema}.{table}") && table != "cluster")
            .Should().ContainSingle().Which.Should().Contain("ref.cluster").And.Contain("not a table of this connection");

    [Fact]
    public void The_declared_variables_are_its_parameters_with_their_types_and_defaults_as_written()
        => ScriptSource.Parameters(View10117(), null).Should().Equal(
            new ScriptParameter("@start_date", "date", "'2026-01-01'"),
            new ScriptParameter("@end_date", "date", "CAST(GETDATE() AS DATE)"),
            new ScriptParameter("@mode", "varchar(10)", "'total'"),
            new ScriptParameter("@cluster", "varchar(20)", "NULL"),
            new ScriptParameter("@plant", "nvarchar(100)", "NULL"));

    [Fact]
    public void A_parameter_shows_the_field_it_is_bound_to()
        => ScriptSource.Parameters(View10117(), """{"@plant":"Plant.plant_description"}""")
            .Single(p => p.Name == "@plant").Field.Should().Be("Plant.plant_description");

    [Theory]
    [InlineData("SELECT v.value AS Code FROM STRING_SPLIT('a,b', ',') AS v")]
    [InlineData("SELECT p.period_label FROM dbo.fn_GetPeriods('2026-01-01', '2026-02-01', 'monthly') AS p")]
    [InlineData("SELECT p.period_label FROM [AlTasnimBI].[dbo].[fn_GetPeriods]('2026-01-01', '2026-02-01', 'monthly') AS p")]
    [InlineData("SET NOCOUNT ON; DECLARE @latest INT; SELECT @latest = MAX(w.week_number) FROM well.well_progress AS w; SELECT @latest AS Latest")]
    [InlineData("DECLARE @x INT; SET @x = 2; SELECT @x AS X")]
    [InlineData("WITH a AS (SELECT 1 AS n) SELECT a.n FROM a ORDER BY a.n")]
    [InlineData("SELECT AlTasnimBI.dbo.fn_label(1) AS a, dbo.fn_label(2) AS b")]
    [InlineData("SELECT t.a FROM dbo.t AS t WITH (NOLOCK) JOIN dbo.u AS u WITH (READUNCOMMITTED, INDEX(ix_u)) ON u.a = t.a")]
    public void Functions_variables_and_ctes_are_allowed(string sql)
        => Check(sql).Should().BeEmpty();

    [Theory]
    [InlineData("INSERT INTO dbo.t (a) VALUES (1); SELECT 1 AS a", "INSERT")]
    [InlineData("UPDATE dbo.t SET a = 1; SELECT 1 AS a", "UPDATE")]
    [InlineData("DELETE FROM dbo.t; SELECT 1 AS a", "DELETE")]
    [InlineData("MERGE dbo.t AS t USING dbo.s AS s ON t.a = s.a WHEN MATCHED THEN DELETE; SELECT 1 AS a", "MERGE")]
    [InlineData("EXEC dbo.do_something; SELECT 1 AS a", "EXEC")]
    [InlineData("CREATE TABLE dbo.t (a INT); SELECT 1 AS a", "CREATE")]
    [InlineData("DROP TABLE dbo.t; SELECT 1 AS a", "DROP")]
    [InlineData("IF 1 = 1 SELECT 1 AS a", "IF")]
    [InlineData("SELECT t.a INTO dbo.copy FROM dbo.t AS t", "SELECT INTO")]
    [InlineData("SELECT t.a FROM #work AS t", "temporary table")]
    [InlineData("SELECT t.a FROM Other.dbo.t AS t", "another database")]
    [InlineData("SELECT t.a FROM Remote.AlTasnimBI.dbo.t AS t", "another server")]
    [InlineData("SELECT r.a FROM OPENROWSET('SQLNCLI', 'Server=x;Trusted_Connection=yes;', 'SELECT 1 AS a') AS r", "OPENROWSET")]
    [InlineData("SELECT r.a FROM OPENQUERY(Remote, 'SELECT 1 AS a') AS r", "OPENQUERY")]
    [InlineData("DECLARE @a INT = 1;", "final SELECT")]
    [InlineData("SELECT 1 AS a; SELECT 2 AS b", "SELECT")]
    [InlineData("SELECT 1 AS a\nGO\nSELECT 2 AS a", "GO")]
    [InlineData("SELECT FROM WHERE", "does not parse")]
    [InlineData("SELECT d.name FROM sys.databases AS d", "system schema")]
    [InlineData("SELECT c.COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS AS c", "system schema")]
    [InlineData("SELECT t.text FROM sys.dm_exec_sql_text(0x01) AS t", "system schema")]
    [InlineData("SELECT a.statement FROM sys.fn_get_audit_file('x', DEFAULT, DEFAULT) AS a", "system schema")]
    [InlineData("SELECT c.name FROM fn_helpcollations() AS c", "fn_helpcollations")]
    [InlineData("SELECT j.[key] FROM OPENJSON('{}') AS j", "OPENJSON")]
    [InlineData("SELECT t.a FROM plain_table AS t", "without a schema")]
    [InlineData("SELECT Other.dbo.fn_label(1) AS a", "another database")]
    [InlineData("SELECT master.dbo.fn_label(1) AS a", "another database")]
    [InlineData("SELECT sys.fn_varbintohexstr(0x01) AS a", "system schema")]
    [InlineData("SELECT NEXT VALUE FOR dbo.ticket AS n", "NEXT VALUE FOR")]
    [InlineData("SELECT t.a FROM dbo.t AS t WITH (TABLOCKX)", "TABLOCKX")]
    public void Anything_but_declares_and_one_final_select_is_refused_with_a_reason(string sql, string mentioned)
        => Check(sql).Should().Contain(p => p.Contains(mentioned, StringComparison.OrdinalIgnoreCase));

    [Fact]
    public void A_variable_the_batch_sets_again_after_declaring_it_cannot_be_bound()
        => ScriptSource.Parameters("DECLARE @a INT = 1; DECLARE @b INT; DECLARE @c INT; SET @b = 2; SELECT @c = MAX(t.a) FROM dbo.t AS t; SELECT @a AS A, @b AS B, @c AS C", null)
            .Select(p => (p.Name, p.Bindable)).Should().Equal(("@a", true), ("@b", false), ("@c", false));

    [Fact]
    public void A_view_with_its_own_row_order_column_is_refused()
        => ScriptSource.ColumnProblems([new ViewColumn("row_order", "int")]).Should().ContainSingle().Which.Should().Contain("row_order");
}
