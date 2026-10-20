using System.Text.Json;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>
/// Agentic AI → Agentic Features: the embedded seed (settings, access, verified SQL, prompts, rules), the settings each
/// tenant keeps in core.AiSettings, and the helpers the Tenant API uses around the agent runtime.
/// </summary>
public class AgenticFeaturesTests
{
    private static readonly AskDataCatalogDto Catalog = new("AlTasnimBI",
    [
        new AskDataCatalogSchemaDto("dbo", [new AskDataCatalogTableDto("activity_master_csv", ["id"]), new AskDataCatalogTableDto("mapping_master", ["id"])]),
        new AskDataCatalogSchemaDto("well", [new AskDataCatalogTableDto("well_master", ["well_id"]), new AskDataCatalogTableDto("task_daily", ["id"])]),
    ]);

    private static JsonElement J(string json) => JsonSerializer.Deserialize<JsonElement>(json);

    private static FeatureSettingDefinitionDto Def(string type, double? min = null, double? max = null, params string[] options) =>
        new("k", "Label", "", "General", type, J("null"), min, max, options);

    // ── The seed ─────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_seed_holds_the_verified_sql_features_with_their_settings_queries_and_prompts()
    {
        AgenticFeatureCatalog.All.Keys.Should().Contain([AgenticFeatureCatalog.Slippage, AgenticFeatureCatalog.DailyReport]);
        foreach (var key in new[] { AgenticFeatureCatalog.Slippage, AgenticFeatureCatalog.DailyReport })
        {
            var f = AgenticFeatureCatalog.Get(key);
            f.AccessMode.Should().Be(AgenticFeatureCatalog.AccessTables);
            f.Settings.Should().NotBeEmpty();
            f.Queries.Should().NotBeEmpty();
            f.Prompts.Should().NotBeEmpty();
            f.Access.IncludedTables.Should().NotBeEmpty("a new tenant starts with the tables its queries read");
            AgenticFeatureCatalog.QueryTables(f).Should().BeSubsetOf(f.Access.IncludedTables.Select(t => t.ToLowerInvariant()),
                "the default tables must let every verified query run");
        }
    }

    [Fact]
    public void Data_anomaly_reads_by_schema_and_every_seeded_rule_becomes_a_rule_row()
    {
        var f = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.Anomaly);
        f.AccessMode.Should().Be(AgenticFeatureCatalog.AccessSchemas);
        f.Access.AllowedSchemas.Should().NotBeEmpty();
        f.Queries.Should().BeEmpty("its AI writes its own checks");
        f.Rules.Should().HaveCountGreaterThanOrEqualTo(90);

        var rows = f.Rules.Select(r => DataAnomalyService.NewRule(1, r, "system", DataAnomalyService.Hash(r))).ToList();
        rows.Select(r => r.RuleId).Should().OnlyHaveUniqueItems();
        rows.Should().OnlyContain(r => r.Title.Length > 0 && DataAnomalyService.Severities.Contains(r.Severity));
        rows.Should().Contain(r => r.Status == "active").And.Contain(r => r.Source == "discovered");
        // The status chosen in the seed is kept (draft and disabled rules stay off).
        rows.Count(r => r.Status is "draft" or "disabled").Should().BeGreaterThan(0);
    }

    [Fact]
    public void Every_seeded_default_passes_its_own_check()
    {
        foreach (var f in AgenticFeatureCatalog.All.Values)
        {
            f.Settings.Select(d => d.Key).Should().OnlyHaveUniqueItems($"{f.Key} setting keys are unique");
            foreach (var d in f.Settings)
                AgenticFeatureSettingsRules.Check(d, d.Default, out _).Should().BeNull($"{f.Key}.{d.Key} ({d.Type}) default must be valid");
        }
    }

    [Fact]
    public void Feature_prompts_are_their_own_group_on_the_prompts_page_and_their_originals_are_valid()
    {
        foreach (var f in AgenticFeatureCatalog.All.Values)
        {
            AiPromptCatalog.Groups.Should().Contain((f.Key, f.Title));
            foreach (var p in f.Prompts)
            {
                p.Key.Should().StartWith(f.Key + ".");
                AiPromptCatalog.Get(p.Key).Group.Should().Be(f.Key);
                AiPromptCatalog.Problem(AiPromptCatalog.Get(p.Key), p.Text, p.Text).Should().BeNull($"the seed text of {p.Key} must be savable as is");
            }
        }
        AiPromptCatalog.All.Select(d => d.Key).Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void A_feature_receives_only_its_own_prompts()
    {
        var texts = AiPromptCatalog.All.ToDictionary(d => d.Key, d => "text " + d.Key);
        var slippage = AiPromptCatalog.FeatureTexts(texts, AgenticFeatureCatalog.Slippage);
        slippage.Keys.Should().OnlyContain(k => k.StartsWith("slippage.", StringComparison.Ordinal));
        slippage.Should().HaveCount(AgenticFeatureCatalog.Get(AgenticFeatureCatalog.Slippage).Prompts.Count);
        AiPromptCatalog.RuntimeTexts(texts).Keys.Should().NotContain(k => k.StartsWith("slippage.", StringComparison.Ordinal),
            "Ask Data and agent runs do not carry feature prompts");
    }

    [Fact]
    public void Tables_in_sql_skip_ctes_comments_and_strings_and_default_to_dbo()
    {
        const string sql = """
            WITH late AS (SELECT * FROM well.task_daily t JOIN [dbo].[mapping_master] m ON m.id = t.id)
            SELECT 'FROM fake.table' AS note -- JOIN other.table
            FROM late /* JOIN hidden.table */ JOIN activity_master_csv a ON 1 = 1
            """;
        AgenticFeatureCatalog.TablesIn(sql).Should().BeEquivalentTo("well.task_daily", "dbo.mapping_master", "dbo.activity_master_csv");
    }

    // ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("int", "5", null)]
    [InlineData("int", "5.5", "must be a whole number.")]
    [InlineData("int", "\"5\"", "must be a whole number.")]
    [InlineData("int", "50", "must be from 1 to 10.")]
    [InlineData("decimal", "0.25", null)]
    [InlineData("decimal", "true", "must be a number.")]
    [InlineData("bool", "false", null)]
    [InlineData("bool", "0", "must be on or off.")]
    [InlineData("text", "\"abc\"", null)]
    [InlineData("text", "3", "must be text.")]
    [InlineData("list", "[\"a\",\"b\"]", null)]
    [InlineData("list", "[\"a\",1]", "must be a list of texts.")]
    [InlineData("map", "{\"critical\":5}", null)]
    [InlineData("map", "{\"critical\":\"5\"}", "\"critical\" must be a number.")]
    public void A_value_is_checked_against_its_type(string type, string json, string? problem)
    {
        var d = Def(type, type is "int" or "map" ? 1 : null, type is "int" or "map" ? 10 : null);
        AgenticFeatureSettingsRules.Check(d, J(json), out _).Should().Be(problem);
    }

    [Fact]
    public void Enums_accept_only_their_options_and_lists_are_trimmed_and_deduplicated()
    {
        AgenticFeatureSettingsRules.Check(Def("enum", null, null, "main", "fast"), J("\"fast\""), out _).Should().BeNull();
        AgenticFeatureSettingsRules.Check(Def("enum", null, null, "main", "fast"), J("\"slow\""), out _).Should().Be("must be one of main, fast.");

        AgenticFeatureSettingsRules.Check(Def("list"), J("[\" a \",\"a\",\"\",\"b\"]"), out var normal).Should().BeNull();
        normal.EnumerateArray().Select(x => x.GetString()).Should().Equal("a", "b");
    }

    [Fact]
    public void Without_stored_settings_the_defaults_are_used_and_a_bad_stored_value_falls_back()
    {
        var f = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.Slippage);
        var defaults = AgenticFeatureSettingsRules.Resolve(f, null);
        defaults.Customized.Should().BeFalse();
        defaults.Values.Keys.Should().BeEquivalentTo(f.Settings.Select(d => d.Key));
        defaults.Access.Should().BeEquivalentTo(f.Access);

        var intDef = f.Settings.First(d => d.Type == "int" && d.Max is not null);
        var stored = "{\"values\":{\"" + intDef.Key + "\":" + (intDef.Max + 1) + "},\"access\":{\"includedTables\":[\"well.well_master\"]}}";
        var state = AgenticFeatureSettingsRules.Resolve(f, stored);
        state.Customized.Should().BeTrue();
        state.Values[intDef.Key].GetRawText().Should().Be(intDef.Default.GetRawText(), "an out-of-range stored value is not sent to the runtime");
        state.Access.IncludedTables.Should().Equal("well.well_master");

        AgenticFeatureSettingsRules.Resolve(f, "not json").Customized.Should().BeFalse();
    }

    [Fact]
    public void A_save_is_checked_against_the_definitions_and_the_database_and_stored_in_the_features_column()
    {
        var f = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.Slippage);
        var intDef = f.Settings.First(d => d.Type == "int" && d.Min is not null);
        var s = new AiSettings();
        var request = new SaveAgenticFeatureSettingsRequest(
            new Dictionary<string, JsonElement> { [intDef.Key] = J(((int)intDef.Min!.Value).ToString()) },
            new FeatureAccessDto([], ["WELL.WELL_MASTER", "well.task_daily"], [], []));

        var state = AgenticFeatureSettingsRules.Apply(s, f, request, Catalog, "admin@x");

        state.Values[intDef.Key].GetInt32().Should().Be((int)intDef.Min!.Value);
        state.Access.IncludedTables.Should().Equal("well.well_master", "well.task_daily");   // the database's spelling
        s.SlippageSettingsJson.Should().Contain("\"modifiedBy\":\"admin@x\"");
        s.DailyReportSettingsJson.Should().BeNull();
        AgenticFeatureSettingsRules.Resolve(f, s.SlippageSettingsJson).Values[intDef.Key].GetInt32().Should().Be((int)intDef.Min!.Value);
    }

    [Fact]
    public void A_save_lists_every_problem_and_changes_nothing()
    {
        var f = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.Slippage);
        var s = new AiSettings();
        var request = new SaveAgenticFeatureSettingsRequest(
            new Dictionary<string, JsonElement> { ["noSuchSetting"] = J("1") },
            new FeatureAccessDto([], ["well.no_such_table"], ["bad..name"], []));

        var act = () => AgenticFeatureSettingsRules.Apply(s, f, request, Catalog, "admin");

        act.Should().Throw<InvalidOperationException>()
            .Which.Message.Should().Contain("\"noSuchSetting\" is not a setting").And.Contain("well.no_such_table").And.Contain("Hidden tables");
        s.SlippageSettingsJson.Should().BeNull();
    }

    [Fact]
    public void A_tables_feature_needs_a_table_and_reset_restores_the_defaults()
    {
        var f = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.DailyReport);
        var s = new AiSettings();
        var act = () => AgenticFeatureSettingsRules.Apply(s, f, new(null, FeatureAccessDto.Empty), Catalog, "admin");
        act.Should().Throw<InvalidOperationException>().WithMessage("*Choose at least one table Daily Report may read*");

        AgenticFeatureSettingsRules.IsConfigured(f, f.Access).Should().BeTrue();
        AgenticFeatureSettingsRules.IsConfigured(f, FeatureAccessDto.Empty).Should().BeFalse();

        s.DailyReportSettingsJson = "{}";
        AgenticFeatureSettingsRules.Reset(s, f.Key);
        s.DailyReportSettingsJson.Should().BeNull();
    }

    // ── Tenant API helpers ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_runtimes_refusals_are_read_as_safe_messages()
    {
        AgentRuntimeClient.Detail("""{"detail":"Slippage may not read x."}""").Should().Be("Slippage may not read x.");
        AgentRuntimeClient.Detail("""{"detail":{"message":"busy"}}""").Should().Be("busy");
        AgentRuntimeClient.Detail("""{"detail":[{"loc":["body","reportDate"],"msg":"Field required"}]}""").Should().Be("reportDate: Field required");
        AgentRuntimeClient.Detail("<html>").Should().BeNull();
    }

    [Fact]
    public void A_query_seed_hash_changes_with_its_sql()
    {
        var q = new FeatureQuerySeed("k", "Label", null, "SELECT 1", [], ["a"]);
        var hash = AiFeatureQueryStore.Hash(q);
        hash.Should().HaveLength(64).And.Be(AiFeatureQueryStore.Hash(q with { }));
        AiFeatureQueryStore.Hash(q with { Sql = "SELECT 2" }).Should().NotBe(hash);
    }

    [Fact]
    public void A_family_members_probe_belongs_to_its_rule()
    {
        var rules = new HashSet<string>(["R12", "R7-A"], StringComparer.OrdinalIgnoreCase);
        AgenticJobRunner.OwnerRule("R12", rules).Should().Be("R12");
        AgenticJobRunner.OwnerRule("R12-003", rules).Should().Be("R12");
        AgenticJobRunner.OwnerRule("R7-A", rules).Should().Be("R7-A");
        AgenticJobRunner.OwnerRule("X9", rules).Should().Be("X9");
    }

    [Fact]
    public void Usage_entries_become_one_log_row_each_with_the_feature_as_purpose()
    {
        var logged = new List<AiUsageLog>();
        var repo = new Mock<TWise.Tenant.Application.Abstractions.IAiUsageRepository>();
        repo.Setup(r => r.AddAsync(It.IsAny<AiUsageLog>(), It.IsAny<CancellationToken>()))
            .Callback<AiUsageLog, CancellationToken>((l, _) => logged.Add(l)).Returns(Task.CompletedTask);

        var reply = J("""{"usage":[{"agent":"slippage.advisor","model":"m","calls":1,"input":120,"output":30},{"model":"m","input":5}],"x":1}""");
        AgenticFeatureGateway.LogUsageAsync(repo.Object, 7, "u1", "slippage", reply).GetAwaiter().GetResult();

        logged.Should().HaveCount(2);
        logged[0].Purpose.Should().Be("slippage");
        logged[0].PromptTokens.Should().Be(120);
        logged[0].CompletionTokens.Should().Be(30);
        logged[1].CompletionTokens.Should().Be(0);
        logged.Should().OnlyContain(l => l.TenantId == 7 && l.UserId == "u1" && l.Succeeded);
    }
}
