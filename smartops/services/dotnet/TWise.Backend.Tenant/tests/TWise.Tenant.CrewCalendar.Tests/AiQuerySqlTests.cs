using System.Text.Json;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class ViewSqlWrapperTests
{
    [Fact]
    public void Plain_select_becomes_a_derived_table()
    {
        var w = ViewSqlWrapper.Wrap("SELECT a, b FROM dbo.t", "_x", stripOrderBy: true)!;
        Assert.Equal("", w.Head);
        Assert.Equal("(SELECT a, b FROM dbo.t) AS _x", w.Relation);
    }

    [Fact]
    public void Cte_view_gets_one_more_cte_instead_of_a_subquery()
    {
        var w = ViewSqlWrapper.Wrap("WITH a AS (SELECT 1 AS n), b (m) AS (SELECT n FROM a) SELECT m FROM b", "_x", stripOrderBy: true)!;
        Assert.Equal("_x", w.Relation);
        Assert.StartsWith("WITH a AS (SELECT 1 AS n), b (m) AS (SELECT n FROM a),", w.Head);
        Assert.Contains("_x AS (\nSELECT m FROM b\n)", w.Head);
    }

    [Fact]
    public void Leading_semicolon_and_comments_are_ignored()
    {
        Assert.NotNull(ViewSqlWrapper.Wrap("-- report\n/* v2 */ ;WITH a AS (SELECT 1 AS n) SELECT n FROM a", "_x", true));
    }

    [Theory]
    [InlineData("DECLARE @d date = GETDATE(); SELECT 1")]
    [InlineData("SELECT * INTO #t FROM a; SELECT * FROM #t")]
    [InlineData("SELECT 1; SELECT 2")]
    [InlineData("EXEC dbo.report")]
    [InlineData("UPDATE t SET a = 1")]
    public void Batches_are_not_wrapped(string sql) => Assert.Null(ViewSqlWrapper.Wrap(sql, "_x", true));

    [Fact]
    public void Column_names_that_contain_keywords_do_not_make_it_a_batch()
    {
        // The old check matched "created_at" as CREATE and "asset" as SET, and skipped such views.
        Assert.NotNull(ViewSqlWrapper.Wrap("SELECT created_at, updated_at, asset, [order by] FROM dbo.t WHERE note = 'drop; it'", "_x", false));
    }

    [Fact]
    public void Trailing_order_by_is_dropped_or_refused()
    {
        Assert.Equal("(SELECT a FROM t) AS _x", ViewSqlWrapper.Wrap("SELECT a FROM t ORDER BY a DESC", "_x", stripOrderBy: true)!.Relation);
        Assert.Null(ViewSqlWrapper.Wrap("SELECT a FROM t ORDER BY a DESC", "_x", stripOrderBy: false));
        // With TOP, ORDER BY is legal in a derived table and part of the meaning, so it stays.
        Assert.Contains("ORDER BY a", ViewSqlWrapper.Wrap("SELECT TOP 5 a FROM t ORDER BY a", "_x", stripOrderBy: false)!.Relation);
        // ORDER BY inside OVER (...) is not a trailing ORDER BY.
        Assert.NotNull(ViewSqlWrapper.Wrap("SELECT ROW_NUMBER() OVER (ORDER BY a) AS r FROM t", "_x", stripOrderBy: false));
    }

    [Fact]
    public void Create_view_prefix_is_removed()
    {
        Assert.Equal("(SELECT a FROM t) AS _x", ViewSqlWrapper.Wrap("CREATE OR REPLACE VIEW v AS SELECT a FROM t", "_x", true)!.Relation);
    }
}

public class QuerySpecSqlTests
{
    private static readonly string[] Columns = ["Cluster", "well_id", "progress", "start_date"];

    private static AiQuerySpec Spec(string json) =>
        QuerySpecEngine.Validate(JsonSerializer.Deserialize<AiQuerySpec>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!, Columns);

    [Fact]
    public void Aggregation_is_grouped_sorted_and_limited_in_sql()
    {
        var b = QuerySpecSql.Build("SELECT * FROM dbo.atp",
            Spec("""{"groupBy":["cluster"],"measures":[{"agg":"sum","column":"progress","alias":"total"},{"agg":"count"}],"sort":{"column":"total","descending":true},"limit":10}"""), Columns)!;

        Assert.Contains("SELECT TOP (@ai_p0) [Cluster], ROUND(SUM(TRY_CAST([progress] AS float)), 4) AS [total], COUNT(*) AS [count], COUNT(*) OVER () AS [__ai_total]", b.Sql);
        Assert.Contains("FROM (SELECT * FROM dbo.atp) AS _ai_src", b.Sql);
        Assert.Contains("GROUP BY [Cluster]", b.Sql);
        Assert.EndsWith("ORDER BY [total] DESC", b.Sql);
        Assert.Equal(10, b.Parameters[0].Value);
    }

    [Fact]
    public void Filter_values_are_parameters_typed_like_the_in_memory_comparison()
    {
        var b = QuerySpecSql.Build("SELECT * FROM t", Spec("""
            {"select":["well_id"],"filters":[
              {"column":"Cluster","op":"eq","value":"Nimr"},
              {"column":"progress","op":"gte","value":50},
              {"column":"start_date","op":"lt","value":"2026-01-01"},
              {"column":"well_id","op":"in","value":["A1","B2"]},
              {"column":"Cluster","op":"contains","value":"50%_x"},
              {"column":"start_date","op":"notNull"}]}
            """), Columns)!;

        Assert.Contains("CAST([Cluster] AS nvarchar(4000)) = @ai_p0", b.Sql);
        Assert.Contains("TRY_CAST([progress] AS float) >= @ai_p1", b.Sql);
        Assert.Contains("TRY_CAST([start_date] AS datetime2) < @ai_p2", b.Sql);
        Assert.Contains("CAST([well_id] AS nvarchar(4000)) IN (@ai_p3, @ai_p4)", b.Sql);
        Assert.Contains("LIKE @ai_p5 ESCAPE '\\'", b.Sql);
        Assert.Contains("([start_date] IS NOT NULL AND CAST([start_date] AS nvarchar(4000)) <> N'')", b.Sql);
        Assert.Equal("Nimr", b.Parameters[0].Value);
        Assert.Equal(50d, b.Parameters[1].Value);
        Assert.Equal(new DateTime(2026, 1, 1), ((DateTime)b.Parameters[2].Value).Date);
        Assert.Equal("%50\\%\\_x%", b.Parameters[5].Value);
        Assert.DoesNotContain("Nimr", b.Sql);
    }

    [Fact]
    public void Cte_view_is_queried_through_its_own_with_clause()
    {
        var b = QuerySpecSql.Build("WITH x AS (SELECT * FROM t) SELECT * FROM x ORDER BY Cluster",
            Spec("""{"measures":[{"agg":"countDistinct","column":"well_id","alias":"wells"}]}"""), Columns)!;
        Assert.StartsWith("WITH x AS (SELECT * FROM t),\n_ai_src AS (\nSELECT * FROM x\n)\nSELECT TOP (@ai_p0) COUNT(DISTINCT [well_id]) AS [wells]", b.Sql);
        Assert.DoesNotContain("GROUP BY", b.Sql);
    }

    [Fact]
    public void Batch_views_are_left_to_the_caller() =>
        Assert.Null(QuerySpecSql.Build("DECLARE @y int = 2026; SELECT * FROM t", Spec("""{"select":["well_id"]}"""), Columns));
}
