using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class PromptsTests
{
    [Fact]
    public void Custom_text_replaces_the_default_and_empty_restores_it()
    {
        var json = AiPrompts.Save(null, AiPrompts.Answer, "  Answer in one sentence.  ");
        Assert.Equal("Answer in one sentence.", AiPrompts.Text(AiPrompts.Answer, AiPrompts.Parse(json)));
        Assert.Null(AiPrompts.Save(json, AiPrompts.Answer, ""));
        var reset = AiPrompts.Text(AiPrompts.Answer, AiPrompts.Parse(null));
        Assert.StartsWith("You are a concise data analyst.", reset);
    }

    [Fact]
    public void Dataset_prompts_override_the_tenant_and_rules_add_up()
    {
        var tenant = new Dictionary<string, string> { [AiPrompts.AskRules] = "Years are fiscal.", [AiPrompts.Answer] = "Be brief." };
        var dataset = new[]
        {
            new AiDatasetPrompt { Key = AiPrompts.AskRules, Text = "Wells are identified by well_code." },
            new AiDatasetPrompt { Key = AiPrompts.Report, Text = "Focus on safety." },
            new AiDatasetPrompt { Key = AiPrompts.ChartEdit, Text = "ignored: not a dataset key" },
        };
        var merged = AiPrompts.Merge(tenant, dataset);
        Assert.Equal("Years are fiscal.\nWells are identified by well_code.", merged[AiPrompts.AskRules]);
        Assert.Equal("Be brief.", merged[AiPrompts.Answer]);
        Assert.Equal("Focus on safety.", AiPrompts.Text(AiPrompts.Report, merged));
        Assert.False(merged.ContainsKey(AiPrompts.ChartEdit));

        var dtos = AiPrompts.ToDatasetDtos(tenant, dataset);
        Assert.Equal(AiPrompts.DatasetKeys.Length, dtos.Count);
        var answer = dtos.Single(d => d.Key == AiPrompts.Answer);
        Assert.Equal("Be brief.", answer.DefaultText);
        Assert.False(answer.IsCustom);
        Assert.True(dtos.Single(d => d.Key == AiPrompts.Report).IsCustom);
    }

    [Fact]
    public void Saving_the_default_text_is_not_custom()
    {
        var def = AiPrompts.All.First(p => p.Key == AiPrompts.ChartSummary).Default;
        Assert.Null(AiPrompts.Save(null, AiPrompts.ChartSummary, def));
    }

    [Fact]
    public void Other_keys_are_kept_when_one_changes()
    {
        var json = AiPrompts.Save(null, AiPrompts.AskRules, "A year means the fiscal year.");
        json = AiPrompts.Save(json, AiPrompts.Answer, "Short answers.");
        var dtos = AiPrompts.ToDtos(AiPrompts.Parse(json));
        Assert.Equal(["ask-rules", "answer"], dtos.Where(d => d.IsCustom).Select(d => d.Key));
        Assert.Equal("A year means the fiscal year.", dtos.First(d => d.Key == AiPrompts.AskRules).Text);
    }

    [Fact]
    public void Unknown_keys_too_long_texts_and_bad_json_are_handled()
    {
        Assert.Throws<InvalidOperationException>(() => AiPrompts.Save(null, "spec", "x"));
        Assert.Throws<InvalidOperationException>(() => AiPrompts.Save(null, AiPrompts.Answer, new string('x', AiPrompts.MaxLength + 1)));
        Assert.Empty(AiPrompts.Parse("not json"));
    }
}
