using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Ask Data's settings in core.AiSettings: reading them for the page and the runtime, and checking a save.</summary>
public class AskDataSettingsRulesTests
{
    private static readonly AskDataCatalogDto Catalog = new("AlTasnimBI",
    [
        new AskDataCatalogSchemaDto("dbo", [new AskDataCatalogTableDto("employee", ["id", "name"])]),
        new AskDataCatalogSchemaDto("well", [new AskDataCatalogTableDto("well_master", ["well_id", "location_dd"])]),
    ]);

    private static SaveAskDataSettingsRequest Request(IReadOnlyList<string>? schemas = null, IReadOnlyList<string>? tables = null,
        IReadOnlyList<string>? columns = null, int maxRows = 500, int timeout = 60, int queries = 3, int sqlRetries = 2,
        int verifyRetries = 1, int turns = 3, string? org = "Al-Tasnim", string? prefix = "ask-data") =>
        new(schemas ?? ["well"], tables ?? [], columns ?? [], maxRows, timeout, queries, sqlRetries, verifyRetries, turns, org, prefix);

    [Fact]
    public void No_settings_row_means_not_set_up_and_the_runtime_gets_no_schemas()
    {
        var dto = AskDataSettingsRules.ToDto(null);
        dto.Configured.Should().BeFalse();
        dto.AllowedSchemas.Should().BeEmpty();

        var runtime = AskDataSettingsRules.ToRuntime(null);
        runtime.AllowedSchemas.Should().BeEmpty();
        runtime.MaxRows.Should().Be(500);
        runtime.ExportPrefix.Should().Be(AskDataSettingsRules.DefaultExportPrefix);
        runtime.OrgName.Should().BeEmpty();
    }

    [Fact]
    public void Stored_lists_are_read_and_bad_json_is_empty()
    {
        var s = new AiSettings
        {
            AskDataAllowedSchemas = "[\"well\",\"dbo\"]", AskDataExcludedTables = "not json", AskDataExcludedColumns = "[\"location_dd\", \" \"]",
            AskDataMaxRows = 250, AskDataOrgName = "Acme", AskDataExportPrefix = "acme",
        };
        var runtime = AskDataSettingsRules.ToRuntime(s);
        runtime.AllowedSchemas.Should().Equal("well", "dbo");
        runtime.ExcludedTables.Should().BeEmpty();
        runtime.ExcludedColumns.Should().Equal("location_dd");
        runtime.MaxRows.Should().Be(250);
        runtime.OrgName.Should().Be("Acme");
        runtime.ExportPrefix.Should().Be("acme");
        AskDataSettingsRules.ToDto(s).Configured.Should().BeTrue();
    }

    [Fact]
    public void A_valid_save_is_cleaned_and_stored_with_the_databases_spelling()
    {
        var s = new AiSettings();
        AskDataSettingsRules.Apply(s, Request(schemas: ["WELL", " dbo ", "well"], tables: ["dbo.sysdiagrams", "DBO.sysdiagrams", "audit_log"],
            columns: ["well.well_master.location_dd", "password_hash"], org: "  Acme  ", prefix: "Acme-Data"), Catalog);

        AskDataSettingsRules.ParseList(s.AskDataAllowedSchemas).Should().Equal("well", "dbo");
        AskDataSettingsRules.ParseList(s.AskDataExcludedTables).Should().Equal("dbo.sysdiagrams", "audit_log");
        AskDataSettingsRules.ParseList(s.AskDataExcludedColumns).Should().Equal("well.well_master.location_dd", "password_hash");
        s.AskDataOrgName.Should().Be("Acme");
        s.AskDataExportPrefix.Should().Be("acme-data");
    }

    [Fact]
    public void A_table_list_replaces_the_schemas_and_hidden_tables()
    {
        var s = new AiSettings { AskDataExcludedTables = "[\"dbo.sysdiagrams\"]" };
        AskDataSettingsRules.Apply(s, Request(schemas: ["dbo"], tables: ["audit_log"]) with
        {
            IncludedTables = ["WELL.Well_Master", " dbo.employee ", "well.well_master"],
        }, Catalog);

        AskDataSettingsRules.ParseList(s.AskDataIncludedTables).Should().Equal("well.well_master", "dbo.employee");
        AskDataSettingsRules.ParseList(s.AskDataAllowedSchemas).Should().Equal("well", "dbo");
        AskDataSettingsRules.ParseList(s.AskDataExcludedTables).Should().BeEmpty();

        var dto = AskDataSettingsRules.ToDto(s);
        dto.Configured.Should().BeTrue();
        dto.IncludedTables.Should().Equal("well.well_master", "dbo.employee");
        AskDataSettingsRules.ToRuntime(s).IncludedTables.Should().Equal("well.well_master", "dbo.employee");
    }

    [Fact]
    public void A_table_list_needs_a_table_and_only_tables_the_database_has()
    {
        var empty = () => AskDataSettingsRules.Apply(new AiSettings(), Request() with { IncludedTables = [] }, Catalog);
        empty.Should().Throw<InvalidOperationException>().WithMessage("*at least one table*");

        var unknown = () => AskDataSettingsRules.Apply(new AiSettings(), Request() with { IncludedTables = ["well.well_master", "hr.salary", "employee"] }, Catalog);
        unknown.Should().Throw<InvalidOperationException>().WithMessage("*not in the AlTasnimBI database*hr.salary*employee*");
    }

    [Fact]
    public void An_older_client_without_a_table_list_saves_schemas_and_hidden_tables_as_before()
    {
        var s = new AiSettings { AskDataIncludedTables = "[\"well.well_master\"]" };
        AskDataSettingsRules.Apply(s, Request(schemas: ["dbo"], tables: ["dbo.sysdiagrams"]), Catalog);

        AskDataSettingsRules.ParseList(s.AskDataIncludedTables).Should().BeEmpty();
        AskDataSettingsRules.ParseList(s.AskDataAllowedSchemas).Should().Equal("dbo");
        AskDataSettingsRules.ParseList(s.AskDataExcludedTables).Should().Equal("dbo.sysdiagrams");
    }

    [Fact]
    public void A_save_needs_a_schema_that_exists_in_the_database()
    {
        var empty = () => AskDataSettingsRules.Apply(new AiSettings(), Request(schemas: []), Catalog);
        empty.Should().Throw<InvalidOperationException>().WithMessage("*at least one schema*");

        var unknown = () => AskDataSettingsRules.Apply(new AiSettings(), Request(schemas: ["well", "sys", "hr"]), Catalog);
        unknown.Should().Throw<InvalidOperationException>().WithMessage("*not in the AlTasnimBI database*sys, hr*");
    }

    [Theory]
    [InlineData("dbo.t;DROP TABLE x")]
    [InlineData("[dbo].[t]")]
    [InlineData("a.b.c")]
    [InlineData("dbo.")]
    public void Hidden_tables_must_be_plain_names(string table)
    {
        var act = () => AskDataSettingsRules.Apply(new AiSettings(), Request(tables: [table]), Catalog);
        act.Should().Throw<InvalidOperationException>().WithMessage("*schema.table or table*");
    }

    [Theory]
    [InlineData("a.b.c.d")]
    [InlineData("col'umn")]
    public void Hidden_columns_must_be_plain_names(string column)
    {
        var act = () => AskDataSettingsRules.Apply(new AiSettings(), Request(columns: [column]), Catalog);
        act.Should().Throw<InvalidOperationException>().WithMessage("*schema.table.column*");
    }

    [Fact]
    public void Limits_are_checked_and_every_problem_is_reported_at_once()
    {
        var act = () => AskDataSettingsRules.Apply(new AiSettings(),
            Request(maxRows: 0, timeout: 1000, queries: 11, sqlRetries: -1, verifyRetries: 4, turns: 21, prefix: "bad prefix!"), Catalog);
        act.Should().Throw<InvalidOperationException>()
            .Where(e => e.Message.Contains("Rows per query must be from 1 to 10,000")
                     && e.Message.Contains("Query time limit (seconds) must be from 5 to 600")
                     && e.Message.Contains("Queries per question must be from 1 to 10")
                     && e.Message.Contains("SQL rewrites after an error must be from 0 to 5")
                     && e.Message.Contains("Answer re-checks must be from 0 to 3")
                     && e.Message.Contains("Conversation turns remembered must be from 0 to 20")
                     && e.Message.Contains("export file prefix"));
    }

    [Fact]
    public void A_failed_save_changes_nothing()
    {
        var s = new AiSettings { AskDataAllowedSchemas = "[\"dbo\"]", AskDataMaxRows = 500 };
        var act = () => AskDataSettingsRules.Apply(s, Request(schemas: ["well"], maxRows: 0), Catalog);
        act.Should().Throw<InvalidOperationException>();
        s.AskDataAllowedSchemas.Should().Be("[\"dbo\"]");
        s.AskDataMaxRows.Should().Be(500);
    }
}
