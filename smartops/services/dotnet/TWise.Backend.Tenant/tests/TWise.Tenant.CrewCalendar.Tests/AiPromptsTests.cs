using System.Text.RegularExpressions;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

/// <summary>AI prompts come only from the tenant database; the seed is the one place their first texts live.</summary>
public class PromptsTests
{
    private static IReadOnlyDictionary<string, string> Seed => AiPromptStore.Seed;

    [Fact]
    public void A_prompt_the_tenant_lacks_is_an_error_not_a_built_in_default()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => AiPrompts.Text(AiPrompts.Answer, new Dictionary<string, string>()));
        Assert.Contains("'answer' is not configured", ex.Message);
        Assert.Equal("Short.", AiPrompts.Text(AiPrompts.Answer, new Dictionary<string, string> { [AiPrompts.Answer] = "Short." }));
        // "Extra rules for questions" may be empty: no extra rules.
        Assert.Equal("", AiPrompts.Text(AiPrompts.AskRules, new Dictionary<string, string> { [AiPrompts.AskRules] = "" }));
    }

    [Fact]
    public void Dataset_prompts_override_the_tenant_and_rules_add_up()
    {
        var tenant = new Dictionary<string, string>(Seed) { [AiPrompts.AskRules] = "Years are fiscal.", [AiPrompts.Answer] = "Be brief." };
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
        Assert.Equal(Seed[AiPrompts.ChartEdit], merged[AiPrompts.ChartEdit]);

        var dtos = AiPrompts.ToDatasetDtos(tenant, dataset);
        Assert.Equal(AiPrompts.DatasetKeys.Length, dtos.Count);
        var answer = dtos.Single(d => d.Key == AiPrompts.Answer);
        Assert.Equal("Be brief.", answer.DefaultText);
        Assert.False(answer.IsCustom);
        Assert.True(dtos.Single(d => d.Key == AiPrompts.Report).IsCustom);
    }

    [Fact]
    public void The_seed_holds_exactly_the_catalog_and_every_seed_text_is_valid()
    {
        Assert.Equal(AiPromptCatalog.All.Select(d => d.Key).Order(), Seed.Keys.Order());
        foreach (var def in AiPromptCatalog.All)
        {
            var text = Seed[def.Key];
            Assert.Equal(text.Trim(), text);
            Assert.Null(AiPromptCatalog.Problem(def, text, text));
        }
        Assert.Equal(95, Seed.Count);
    }

    [Fact]
    public void The_ai_feature_originals_are_the_texts_the_features_used()
    {
        Assert.StartsWith("You are a concise data analyst. Answer the user's question in 1-3 plain sentences", Seed[AiPrompts.Answer]);
        Assert.Equal("", Seed[AiPrompts.AskRules]);
        Assert.Contains("FINISH", Seed["agent.supervisor"]);
        Assert.Contains("{WORKERS}", Seed["agent.supervisor"]);
    }

    [Fact]
    public void A_save_must_keep_the_placeholders_and_the_reply_format()
    {
        var supervisor = AiPromptCatalog.Get("agent.supervisor");
        var original = Seed[supervisor.Key];
        Assert.Null(AiPromptCatalog.Problem(supervisor, "Pick wisely.\n{WORKERS}\nReply {\"next\": \"x\"}", original));
        Assert.Contains("{WORKERS}", AiPromptCatalog.Problem(supervisor, "Pick wisely. Reply {\"next\": \"x\"}", original));
        Assert.Contains("\"next\"", AiPromptCatalog.Problem(supervisor, "Pick wisely.\n{WORKERS}", original));
        Assert.Contains("cannot be empty", AiPromptCatalog.Problem(supervisor, "", original));
        Assert.Contains("under 100,000 characters", AiPromptCatalog.Problem(supervisor, new string('x', AiPromptCatalog.MaxLength + 1), original));

        var author = AiPromptCatalog.Get("askdata.sql_author_system");
        var authorOriginal = Seed[author.Key];
        Assert.Equal(["PLATFORM_PREAMBLE", "SQL_KNOWLEDGE", "BUSINESS_RULES", "SQL_RULES", "FEW_SHOTS"],
            AiPromptCatalog.Placeholders(authorOriginal).Order().ToArray() is var p && p.Length == 5 ? AiPromptCatalog.Placeholders(authorOriginal) : p);
        Assert.Contains("{BUSINESS_RULES}", AiPromptCatalog.Problem(author, authorOriginal.Replace("{BUSINESS_RULES}", ""), authorOriginal));

        // {{ORG_NAME}} is optional: removing it is allowed.
        var chitchat = AiPromptCatalog.Get("askdata.chitchat_system");
        Assert.Null(AiPromptCatalog.Problem(chitchat, "Be friendly.", Seed[chitchat.Key]));
        Assert.Null(AiPromptCatalog.Problem(AiPromptCatalog.Get(AiPrompts.AskRules), "", ""));
    }

    [Fact]
    public void The_runtime_gets_only_its_own_prompts()
    {
        var runtime = AiPromptCatalog.RuntimeTexts(Seed);
        Assert.Equal(82, runtime.Count);
        Assert.All(runtime.Keys, k => Assert.Matches(new Regex("^(askdata|agent)\\."), k));
        Assert.DoesNotContain(AiPrompts.Answer, runtime.Keys);
    }

    [Fact]
    public void Unknown_keys_and_bad_json_are_handled()
    {
        Assert.Throws<InvalidOperationException>(() => AiPromptCatalog.Get("spec"));
        Assert.False(AiPromptCatalog.IsKnown("spec"));
        Assert.Empty(AiPrompts.Parse("not json"));
        Assert.Empty(AiPrompts.Parse(null));
    }
}
