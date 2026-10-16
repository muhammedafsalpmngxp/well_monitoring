using TWise.Tenant.Application.Features.Ai;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class ValueMatcherTests
{
    private static readonly string[] Columns = ["cluster_name", "plant_description", "well_id", "Crew Code"];

    [Fact]
    public void Terms_skip_common_words_column_names_and_small_numbers()
    {
        var t = ValueMatcher.Terms("How many wells in Marmul by cluster name for the top 10?", Columns);
        Assert.Equal(["wells", "Marmul", "wells Marmul"], t);
    }

    [Fact]
    public void Quoted_phrases_are_kept_whole_and_first()
    {
        var t = ValueMatcher.Terms("Show crews in 'Marmul ODC' with code 3522-FCE", Columns);
        Assert.Equal("Marmul ODC", t[0]);
        Assert.Contains("3522-FCE", t);
    }

    [Fact]
    public void Each_value_goes_to_the_longest_word_it_contains_exact_matches_first()
    {
        var m = ValueMatcher.Assign(["Marmul ODC", "Marmul"], [
            ("plant_description", "Marmul ODC", 935), ("plant_description", "Marmul Projects", 17), ("cluster_name", "Marmul", 1427)]);
        Assert.Equal(("Marmul ODC", "Marmul ODC"), (m[0].Term, m[0].Value));
        var marmul = m.Where(x => x.Term == "Marmul").ToList();
        Assert.Equal(["Marmul", "Marmul Projects"], marmul.Select(x => x.Value));
    }

    [Fact]
    public void A_value_with_several_question_words_is_grouped_under_them()
    {
        var m = ValueMatcher.Assign(["Marmul", "flowline"], [("Category", "Marmul Flowline", 295), ("Category", "Nimr Flowline", 108)]);
        Assert.Contains(m, x => x.Term == "Marmul flowline" && x.Value == "Marmul Flowline");
        Assert.Contains(m, x => x.Term == "flowline" && x.Value == "Nimr Flowline");
    }

    [Fact]
    public void Rows_in_memory_are_counted_case_insensitively()
    {
        var rows = new[] { "NIMR ODC", "Nimr ODC", "Marmul ODC" }.Select(v => (IReadOnlyDictionary<string, object?>)new Dictionary<string, object?> { ["plant_description"] = v });
        var m = ValueMatcher.FindInRows(["nimr"], rows, ["plant_description"]);
        Assert.Equal(2, m.Count);
        Assert.All(m, x => Assert.Equal(1, x.Count));
    }

    [Fact]
    public void Prompt_block_lists_matches_and_words_with_no_value()
    {
        var matches = ValueMatcher.Assign(["wells Marmul", "wells", "Marmul"], [("cluster_name", "Marmul", 1427)]);
        var unmatched = ValueMatcher.Unmatched(["wells Marmul", "wells", "Marmul"], matches, "How many wells in Marmul");
        Assert.Equal(["wells"], unmatched);
        var text = ValueMatcher.Describe(matches, unmatched);
        Assert.Contains("- \"Marmul\": cluster_name = 'Marmul' (1,427 rows)", text);
        Assert.Contains("No stored value contains: \"wells\"", text);
    }

    [Fact]
    public void Lookup_sql_searches_all_text_columns_in_one_scan()
    {
        var sql = ProfileSql.Lookup("SELECT * FROM t", ["Well Name", "Crew Code"], 2, 200)!;
        Assert.Contains("CROSS APPLY (VALUES (N'Well Name', CAST([Well Name] AS nvarchar(400))), (N'Crew Code', CAST([Crew Code] AS nvarchar(400)))) AS x(c, v)", sql);
        Assert.Contains("x.v LIKE @t0 ESCAPE '\\' OR x.v LIKE @t1 ESCAPE '\\'", sql);
        Assert.EndsWith("GROUP BY x.c, x.v\nORDER BY COUNT(*) DESC", sql);
    }
}
