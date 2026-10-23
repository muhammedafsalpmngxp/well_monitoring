using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>
/// Daily Report's 40 prompts became 10: six hold the earlier ones as "## name" sections (MergedFrom), three message
/// wrappers moved into code. A tenant sees 10 prompts, a save keeps the headings, and the first time a tenant gets a
/// merged prompt it starts from the tenant's own saved edit of each earlier prompt.
/// </summary>
public class PromptMergeTests
{
    private static IReadOnlyList<FeaturePromptSeed> DailyReport => AgenticFeatureCatalog.Get(AgenticFeatureCatalog.DailyReport).Prompts;
    private static IEnumerable<FeaturePromptSeed> Merged => DailyReport.Where(p => p.MergedFrom.Count > 0);

    [Fact]
    public void A_tenant_sees_ten_daily_report_prompts_and_none_of_the_earlier_keys()
    {
        DailyReport.Should().HaveCount(10);
        AiPromptCatalog.FeatureTexts(AiPromptCatalog.All.ToDictionary(d => d.Key, d => "t"), AgenticFeatureCatalog.DailyReport)
            .Should().HaveCount(10);
        AiPromptCatalog.IsKnown("dailyreport.notes").Should().BeTrue();
        foreach (var earlier in new[] { "tool_milestones", "evidence_constraints", "planner_user", "writer_revision", "verifier_issues" })
            AiPromptCatalog.IsKnown("dailyreport." + earlier).Should().BeFalse(earlier);
    }

    [Fact]
    public void Each_merged_prompt_has_one_heading_per_earlier_prompt_in_order_and_its_seed_is_a_valid_save()
    {
        Merged.Should().HaveCount(6);
        foreach (var p in Merged)
        {
            PromptSections.Headings(p.Text).Should().Equal(p.MergedFrom.Select(k => k[(k.IndexOf('.') + 1)..]), p.Key);
            PromptSections.Parse(p.Text).Should().OnlyContain(s => s.Body.Length > 0, p.Key);
            AiPromptCatalog.Problem(AiPromptCatalog.Get(p.Key), p.Text, p.Text).Should().BeNull(p.Key);
            PromptSections.Serialize(PromptSections.Parse(p.Text)).Should().Be(p.Text, "the text is exactly its sections: " + p.Key);
        }
    }

    [Fact]
    public void A_save_must_keep_every_heading_and_give_each_section_text_but_may_change_the_words()
    {
        var notes = DailyReport.Single(p => p.Key == "dailyreport.notes");
        var def = AiPromptCatalog.Get(notes.Key);
        var sections = PromptSections.Parse(notes.Text).ToList();

        var withoutOne = PromptSections.Serialize(sections.Skip(1));
        AiPromptCatalog.Problem(def, withoutOne, notes.Text).Should().Contain("## " + sections[0].Name);

        var emptied = PromptSections.Serialize(sections.Select((s, i) => (s.Name, i == 0 ? "" : s.Body)));
        AiPromptCatalog.Problem(def, emptied, notes.Text).Should().Contain("must not be empty");

        var reworded = PromptSections.Serialize(sections.Select((s, i) => (s.Name, i == 0 ? "A new note." : s.Body)));
        AiPromptCatalog.Problem(def, reworded, notes.Text).Should().BeNull();
    }

    [Fact]
    public void Prompts_that_are_not_merged_do_not_need_headings()
    {
        var explain = DailyReport.Single(p => p.Key == "dailyreport.explain_system");
        explain.MergedFrom.Should().BeEmpty();
        AiPromptCatalog.Problem(AiPromptCatalog.Get(explain.Key), "Write plainly.", explain.Text).Should().BeNull();
    }

    [Fact]
    public void A_tenants_saved_edit_of_an_earlier_prompt_becomes_its_section_and_nothing_else_changes()
    {
        var tools = DailyReport.Single(p => p.Key == "dailyreport.tools");
        var carried = PromptSections.Carry(tools.Text, tools.MergedFrom, k =>
            k == "dailyreport.tool_milestones" ? "Deadlines.\n- limit: integer, optional" : null);

        carried.Should().NotBeNull();
        var before = PromptSections.Parse(tools.Text).ToDictionary(s => s.Name, s => s.Body);
        var after = PromptSections.Parse(carried).ToDictionary(s => s.Name, s => s.Body);
        after["tool_milestones"].Should().Be("Deadlines.\n- limit: integer, optional");
        after.Where(kv => kv.Key != "tool_milestones").Should().OnlyContain(kv => before[kv.Key] == kv.Value);
        PromptSections.Headings(carried).Should().Equal(PromptSections.Headings(tools.Text));
    }

    [Fact]
    public void When_a_tenant_never_edited_the_earlier_prompts_the_seed_stands()
    {
        var notes = DailyReport.Single(p => p.Key == "dailyreport.notes");
        var seedBody = PromptSections.Parse(notes.Text).ToDictionary(s => "dailyreport." + s.Name, s => s.Body);

        // The earlier prompts exactly as seeded, absent, empty or only padded with spaces: nothing to carry.
        PromptSections.Carry(notes.Text, notes.MergedFrom, k => seedBody[k]).Should().BeNull();
        PromptSections.Carry(notes.Text, notes.MergedFrom, _ => null).Should().BeNull();
        PromptSections.Carry(notes.Text, notes.MergedFrom, _ => "   ").Should().BeNull();
        PromptSections.Carry(notes.Text, notes.MergedFrom, k => "  " + seedBody[k] + "\n").Should().BeNull();
    }

    [Fact]
    public void Several_edited_earlier_prompts_all_carry_over_and_an_unknown_earlier_key_is_ignored()
    {
        var messages = DailyReport.Single(p => p.Key == "dailyreport.messages");
        var seeded = PromptSections.Parse(messages.Text).ToDictionary(s => s.Name, s => s.Body);
        var editedToolErrors = seeded["tool_errors"].Replace("the tool failed", "it failed");   // every placeholder kept
        editedToolErrors.Should().NotBe(seeded["tool_errors"]);
        var edits = new Dictionary<string, string>
        {
            ["dailyreport.answer_nothing_to_explain"] = "Nothing to explain.",
            ["dailyreport.tool_errors"] = editedToolErrors,
            ["dailyreport.no_such_prompt"] = "ignored",
        };
        var carried = PromptSections.Carry(messages.Text, messages.MergedFrom.Append("dailyreport.no_such_prompt"),
            k => edits.GetValueOrDefault(k));

        var after = PromptSections.Parse(carried).ToDictionary(s => s.Name, s => s.Body);
        after["answer_nothing_to_explain"].Should().Be("Nothing to explain.");
        after["tool_errors"].Should().Be(editedToolErrors);
        after.Should().NotContainKey("no_such_prompt");
        AiPromptCatalog.Problem(AiPromptCatalog.Get(messages.Key), carried!, messages.Text).Should().BeNull("the carried text is a valid save");
    }

    [Fact]
    public void Sections_are_read_with_windows_line_endings_and_loose_headings()
    {
        PromptSections.Parse("Intro\r\n## one  \r\nFirst.\r\n\r\n##   two\r\nSecond a\r\nSecond b\r\n")
            .Should().Equal(("one", "First."), ("two", "Second a\nSecond b"));
        PromptSections.Parse("## one\nA ## b\n### not a heading\n## Two Words").Should().Equal(("one", "A ## b\n### not a heading\n## Two Words"));
        PromptSections.Parse(null).Should().BeEmpty();
    }
}
