using System.Text.Json;
using System.Text.Json.Nodes;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>
/// Data Anomaly → Rules → Add rule / Edit: the definition a request becomes (the agent runtime's rule dict), the checks
/// that refuse what the runtime would refuse, the ids given to new rules, and which rules are defaults.
/// </summary>
public class AnomalyRuleEditorTests
{
    private const string Body = "Wrong: A well has no spud date.\nMatters: Its schedule cannot be measured.\nDetect: Flag wells without one.\nNever flag: Cancelled wells.";

    private static SaveAnomalyRuleRequest Request(string? title = "Spud date missing", string? body = Body, string? severity = null,
        string? status = null, string? method = null, string? expandsOver = null, string? summarySql = null, string? detailSql = null,
        IReadOnlyList<string>? tags = null, IReadOnlyDictionary<string, string>? parameters = null, string? category = null) =>
        new(null, title, category, severity, null, status, tags, body, method, expandsOver, parameters, summarySql, detailSql);

    private static JsonObject Seed(string ruleId) =>
        JsonNode.Parse(AgenticFeatureCatalog.Get(AgenticFeatureCatalog.Anomaly).Rules
            .First(r => r.GetProperty("ruleId").GetString() == ruleId).GetRawText())!.AsObject();

    [Fact]
    public void A_new_rule_gets_every_field_the_runtime_reads_with_defaults()
    {
        var d = DataAnomalyService.RuleDefinition(null, "DQ-U01", Request(tags: [" well ", "", "WELL", "dates"]));

        d["ruleId"]!.GetValue<string>().Should().Be("DQ-U01");
        d["title"]!.GetValue<string>().Should().Be("Spud date missing");
        d["body"]!.GetValue<string>().Should().Be(Body);
        d["category"]!.GetValue<string>().Should().Be("Custom rules");
        d["severity"]!.GetValue<string>().Should().Be("medium");
        d["status"]!.GetValue<string>().Should().Be("active", "a rule added without a status runs once it is compiled");
        d["entity"]!.GetValue<string>().Should().Be("row");
        d["method"]!.GetValue<string>().Should().Be("rule");
        d["sqlMode"]!.GetValue<string>().Should().Be("authored");
        d["source"]!.GetValue<string>().Should().Be("declared");
        d["expandsOver"]!.GetValue<string>().Should().BeEmpty();
        d["tags"]!.AsArray().Select(t => t!.GetValue<string>()).Should().Equal("well", "dates");
        d["params"]!.AsObject().Should().BeEmpty();
        d.ContainsKey("ruleHash").Should().BeFalse();
    }

    [Fact]
    public void The_rule_row_built_from_a_new_definition_is_the_tenants_own()
    {
        var d = DataAnomalyService.RuleDefinition(null, "DQ-U07", Request(severity: "High", status: "Active", category: "Dates"));
        var row = DataAnomalyService.NewRule(5, JsonSerializer.Deserialize<JsonElement>(d.ToJsonString()), "ana@x.com", seedHash: null);

        row.RuleId.Should().Be("DQ-U07");
        row.Severity.Should().Be("high");
        row.Status.Should().Be("active");
        row.Category.Should().Be("Dates");
        row.Source.Should().Be("declared");
        row.SeedHash.Should().BeNull();
        row.CreatedBy.Should().Be("ana@x.com");
    }

    [Fact]
    public void Editing_keeps_what_the_form_does_not_show_and_drops_the_stale_hash()
    {
        var seed = Seed("DQ-A01");
        seed["discovery"] = new JsonObject { ["evidence"] = "seen 12 times" };
        seed["somethingNewer"] = "kept";

        var d = DataAnomalyService.RuleDefinition(seed, "DQ-A01", new SaveAnomalyRuleRequest(
            "IGNORED", "Rig-on date missing", null, null, null, null, null, "Wrong: changed.", null, null, null, null, null));

        d["ruleId"]!.GetValue<string>().Should().Be("DQ-A01", "a rule's id never changes");
        d["title"]!.GetValue<string>().Should().Be("Rig-on date missing");
        d["body"]!.GetValue<string>().Should().Be("Wrong: changed.");
        d["severity"]!.GetValue<string>().Should().Be("critical");
        d["status"]!.GetValue<string>().Should().Be("active");
        d["category"]!.GetValue<string>().Should().Be(seed["category"]!.GetValue<string>());
        d["tags"]!.AsArray().Count.Should().Be(seed["tags"]!.AsArray().Count);
        d["discovery"]!["evidence"]!.GetValue<string>().Should().Be("seen 12 times");
        d["somethingNewer"]!.GetValue<string>().Should().Be("kept");
        d.ContainsKey("ruleHash").Should().BeFalse();
        seed["title"]!.GetValue<string>().Should().NotBe("Rig-on date missing", "the stored definition is not changed in place");
    }

    [Fact]
    public void Saving_a_default_rule_unchanged_gives_the_same_definition()
    {
        foreach (var id in new[] { "DQ-A01", "DQ-G01" })
        {
            var seed = Seed(id);
            var d = DataAnomalyService.RuleDefinition(seed, id, new SaveAnomalyRuleRequest(null, null, null, null, null, null, null,
                null, null, null, null, null, null));
            seed.Remove("ruleHash");
            JsonNode.DeepEquals(seed, d).Should().BeTrue($"{id} saved as it is must not count as an edit");
        }
    }

    [Fact]
    public void A_rejected_rule_stays_rejected_unless_a_status_is_chosen()
    {
        var rejected = new JsonObject { ["ruleId"] = "DQ-S09", ["title"] = "t", ["body"] = "b", ["status"] = "rejected" };
        DataAnomalyService.RuleDefinition(rejected, "DQ-S09", Request(status: null))["status"]!.GetValue<string>().Should().Be("rejected");
        DataAnomalyService.RuleDefinition(rejected, "DQ-S09", Request(status: "probation"))["status"]!.GetValue<string>().Should().Be("probation");
    }

    [Fact]
    public void Own_sql_is_a_starting_point_and_clearing_it_lets_the_ai_write_it()
    {
        var withSql = DataAnomalyService.RuleDefinition(null, "DQ-U01", Request(summarySql: "SELECT 1", detailSql: "SELECT 2"));
        withSql["sqlMode"]!.GetValue<string>().Should().Be("seed");

        var pinned = withSql.DeepClone().AsObject();
        pinned["sqlMode"] = "pinned";
        DataAnomalyService.RuleDefinition(pinned, "DQ-U01", Request())["sqlMode"]!.GetValue<string>().Should().Be("pinned");

        var cleared = DataAnomalyService.RuleDefinition(withSql, "DQ-U01", Request(summarySql: "", detailSql: ""));
        cleared["sqlMode"]!.GetValue<string>().Should().Be("authored");
        cleared["summarySql"]!.GetValue<string>().Should().BeEmpty();
    }

    [Fact]
    public void Values_are_kept_by_lower_case_name()
    {
        var d = DataAnomalyService.RuleDefinition(null, "DQ-U01",
            Request(parameters: new Dictionary<string, string> { [" Tolerance_Days "] = " 30 ", [""] = "x" }));
        d["params"]!.AsObject().Select(p => (p.Key, p.Value!.GetValue<string>())).Should().Equal(("tolerance_days", "30"));
    }

    [Theory]
    [InlineData("", Body, null, null, null, null, null, "title")]
    [InlineData("T", "  ", null, null, null, null, null, "Describe")]
    [InlineData("T", Body, "urgent", null, null, null, null, "severity")]
    [InlineData("T", Body, null, "rejected", null, null, null, "status")]
    [InlineData("T", Body, null, null, "magic", null, null, "method")]
    [InlineData("T", Body, null, null, null, "table", null, "family")]
    [InlineData("T", Body, null, null, null, null, "SELECT 1", "both")]
    [InlineData("T", Body, null, null, null, "foreign_key", "SELECT 1", "family")]
    public void What_the_runtime_would_refuse_is_refused_when_saved(string title, string body, string? severity, string? status,
        string? method, string? expands, string? sql, string message)
    {
        var detail = expands is not null && sql is not null ? "SELECT 2" : null;
        var act = () => DataAnomalyService.RuleDefinition(null, "DQ-U01",
            Request(title, body, severity, status, method, expands, sql, detail));
        act.Should().Throw<InvalidOperationException>().WithMessage($"*{message}*");
    }

    [Fact]
    public void New_rules_are_numbered_after_the_highest_user_rule()
    {
        DataAnomalyService.NextUserRuleId(["DQ-A01", "DQ-S10"]).Should().Be("DQ-U01");
        DataAnomalyService.NextUserRuleId(["DQ-U01", "dq-u09", "DQ-U03", "DQ-UX"]).Should().Be("DQ-U10");
        DataAnomalyService.NextUserRuleId(["DQ-U99"]).Should().Be("DQ-U100");
    }

    [Fact]
    public void Default_rules_are_the_seeds_and_nothing_else()
    {
        DataAnomalyService.IsSeedRule("DQ-A01").Should().BeTrue();
        DataAnomalyService.IsSeedRule("dq-a01").Should().BeTrue();
        DataAnomalyService.IsSeedRule("DQ-U01").Should().BeFalse();
    }

    [Fact]
    public void An_empty_category_keeps_the_rules_own()
    {
        var seed = Seed("DQ-A01");
        DataAnomalyService.RuleDefinition(seed, "DQ-A01", Request(category: ""))["category"]!.GetValue<string>()
            .Should().Be(seed["category"]!.GetValue<string>());
        DataAnomalyService.RuleDefinition(seed, "DQ-A01", Request(category: " Dates "))["category"]!.GetValue<string>().Should().Be("Dates");
    }

    [Fact]
    public void A_save_is_refused_when_the_rule_changed_after_the_form_was_opened()
    {
        var stored = new DateTime(2026, 10, 23, 9, 15, 30, 123, DateTimeKind.Unspecified).AddTicks(4567);
        DataAnomalyService.ChangedSince(stored, null).Should().BeFalse("no time sent: no check");
        DataAnomalyService.ChangedSince(stored, stored).Should().BeFalse();
        DataAnomalyService.ChangedSince(stored, DateTime.SpecifyKind(stored, DateTimeKind.Utc)).Should().BeFalse("the page's value read back as UTC");
        DataAnomalyService.ChangedSince(stored, stored.AddTicks(-4567)).Should().BeFalse("a value rounded to milliseconds still matches");
        DataAnomalyService.ChangedSince(stored, stored.AddSeconds(-5)).Should().BeTrue("someone saved after the form was opened");
        DataAnomalyService.ChangedSince(stored, stored.AddSeconds(5)).Should().BeTrue();
    }

    [Fact]
    public void A_check_that_does_not_run_says_why()
    {
        DataAnomalyService.ProbeReason(J("""{"error":"bad join","verifierNote":"n"}""")).Should().Be("bad join");
        DataAnomalyService.ProbeReason(J("""{"error":"","verifierNote":"no spud date column"}""")).Should().Be("no spud date column");
        var commented = JsonSerializer.SerializeToElement(new { summarySql = "-- RULE X is not compilable: no spud date\n-- column here.\nSELECT 1" });
        DataAnomalyService.ProbeReason(commented).Should().Be("RULE X is not compilable: no spud date column here.");
        DataAnomalyService.ProbeReason(J("""{"summarySql":"SELECT 1"}""")).Should().BeNull();
    }

    [Fact]
    public void A_rule_id_that_names_one_of_a_familys_checks_is_refused()
    {
        var families = new HashSet<string>(["DQ-G01"], StringComparer.OrdinalIgnoreCase);
        DataAnomalyService.FamilyOf("DQ-G01-003", families).Should().Be("DQ-G01");
        DataAnomalyService.FamilyOf("dq-g01-045", families).Should().Be("DQ-G01");
        DataAnomalyService.FamilyOf("DQ-G01-03", families).Should().BeNull("a family's checks are numbered with three digits");
        DataAnomalyService.FamilyOf("DQ-A01-001", families).Should().BeNull("DQ-A01 is not a family");
        DataAnomalyService.FamilyOf("DQ-U01", families).Should().BeNull();
    }

    [Fact]
    public void A_status_change_is_not_a_change_to_the_rules_definition()
    {
        var created = new DateTime(2026, 10, 20, 8, 0, 0);
        var rule = new TWise.Tenant.Domain.Entities.AnomalyRule
        {
            RuleId = "DQ-A01", CreatedAt = created, ModifiedAt = created.AddDays(3), DefinitionJson = """{"ruleId":"DQ-A01","status":"active"}""",
        };
        DataAnomalyService.DefinitionChangedAt(rule).Should().Be(DateTime.SpecifyKind(created, DateTimeKind.Utc),
            "never changed here: when it was added, whatever its status changes did to ModifiedAt");

        var edited = new DateTime(2026, 10, 23, 10, 4, 5, 123, DateTimeKind.Utc).AddTicks(4567);
        rule.DefinitionJson = DataAnomalyService.WithField(rule.DefinitionJson, DataAnomalyService.ChangedAtField, DataAnomalyService.Stamp(edited));
        var at = DataAnomalyService.DefinitionChangedAt(rule);
        at.Should().Be(edited);
        at.Kind.Should().Be(DateTimeKind.Utc);
        DataAnomalyService.ChangedSince(at, edited).Should().BeFalse("the stamp reads back exactly, to the tick");
    }

    [Fact]
    public void The_changed_at_stamp_does_not_make_an_unchanged_save_an_edit()
    {
        var seed = Seed("DQ-A01");
        seed[DataAnomalyService.ChangedAtField] = "2026-10-23T10:04:05.0000000Z";
        var d = DataAnomalyService.RuleDefinition(seed, "DQ-A01", new SaveAnomalyRuleRequest(null, null, null, null, null, null, null,
            null, null, null, null, null, null));
        seed.Remove("ruleHash");
        JsonNode.DeepEquals(seed, d).Should().BeTrue();
    }

    [Fact]
    public void Times_sent_to_the_page_are_marked_utc()
    {
        var stored = new DateTime(2026, 10, 23, 12, 9, 34, DateTimeKind.Unspecified);
        DataAnomalyService.Utc(stored).Kind.Should().Be(DateTimeKind.Utc);
        DataAnomalyService.Utc((DateTime?)stored)!.Value.Kind.Should().Be(DateTimeKind.Utc);
        DataAnomalyService.Utc((DateTime?)null).Should().BeNull();
        System.Text.Json.JsonSerializer.Serialize(DataAnomalyService.Utc(stored)).Should().Be("\"2026-10-23T12:09:34Z\"");
        var job = DataAnomalyService.JobDto(new TWise.Tenant.Domain.Entities.AiFeatureJob { CreatedAt = stored, FinishedAt = stored, RequestedBy = "x" });
        job.CreatedAt.Kind.Should().Be(DateTimeKind.Utc);
        job.FinishedAt!.Value.Kind.Should().Be(DateTimeKind.Utc);
        job.StartedAt.Should().BeNull();
    }

    private static JsonElement J(string json) => JsonSerializer.Deserialize<JsonElement>(json);
}
