using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Moq;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.Dictionary;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Draft the data dictionary with AI: what the AI is shown, and how its reply is checked before the editor gets it.</summary>
public sealed class DictionaryDraftTests
{
    private static readonly AiDictionaryOptions Options = new() { SampleRows = 50, SampleValues = 2, SampleValueLength = 6, MaxColumns = 3 };

    private static readonly DictionaryDatasetDetailDto Dataset = new("view", 9, "Wells", null, null,
    [
        new DictionaryColumnDto("well_id", "string", null, null, null, "internal", null),
        new DictionaryColumnDto("lift_type", "string", "Lift Type", null, null, "internal", null),
        new DictionaryColumnDto("supervisor_email", "string", null, null, null, "pii", null),
        new DictionaryColumnDto("cost", "number", null, null, null, "internal", null),
    ]);

    private static readonly List<Dictionary<string, object?>> Rows =
    [
        new() { ["well_id"] = "NM-0101-LONG", ["lift_type"] = "ESP", ["supervisor_email"] = "ali@tasnim.om" },
        new() { ["well_id"] = "NM-0102", ["lift_type"] = "ESP", ["supervisor_email"] = "sara@tasnim.om" },
        new() { ["well_id"] = "NM-0103", ["lift_type"] = "PCP", ["supervisor_email"] = "omar@tasnim.om" },
    ];

    private sealed record Setup(DraftDictionaryHandler Handler, Mock<IAiService> Ai, List<IReadOnlyList<AiMessage>> Sent);

    private static Setup Build(string reply, bool featureOn = true, DictionaryDatasetDetailDto? dataset = null)
    {
        var governance = new Mock<IGovernanceService>();
        governance.Setup(g => g.GetDatasetAsync("view", 9, 7, It.IsAny<CancellationToken>())).ReturnsAsync(dataset ?? Dataset);
        governance.Setup(g => g.SampleRowsAsync("view", 9, 7, 50, It.IsAny<CancellationToken>())).ReturnsAsync(Rows);
        var ask = new Mock<IAiAskService>();
        ask.Setup(a => a.FeatureOnAsync(7, AiFeatureCatalog.Dictionary, It.IsAny<CancellationToken>())).ReturnsAsync(featureOn);
        var store = new Mock<IAiPromptStore>();
        store.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<string, string> { [AiPrompts.Dictionary] = "Document the columns." });
        var sent = new List<IReadOnlyList<AiMessage>>();
        var ai = new Mock<IAiService>();
        ai.Setup(a => a.CompleteAsync(7, "1", "dictionary", It.IsAny<IReadOnlyList<AiMessage>>(), It.IsAny<CancellationToken>()))
            .Callback((long _, string? _, string _, IReadOnlyList<AiMessage> m, CancellationToken _) => sent.Add(m))
            .ReturnsAsync(new AiCompletion(reply, 10, 10));
        return new Setup(new DraftDictionaryHandler(governance.Object, ai.Object, ask.Object, store.Object, Options), ai, sent);
    }

    private const string Reply = """
        ```json
        {"description":"One row per well.","columns":[
          {"column":"WELL_ID","businessName":"Well","description":"The well's code.","sensitivity":"public","tags":"well, id"},
          {"column":"lift_type","businessName":"Lift Type","description":"How oil is lifted.","sensitivity":"secret","tags":"artificial lift"},
          {"column":"lift_type","businessName":"Duplicate","description":"ignored","sensitivity":"internal"},
          {"column":"supervisor_email","businessName":"Supervisor E-mail","description":"Who supervises.","sensitivity":"pii"},
          {"column":"made_up","businessName":"Not a column","description":"ignored","sensitivity":"internal"}
        ]}
        ```
        """;

    [Fact]
    public async Task Keeps_only_the_dataset_s_columns_once_each_in_its_spelling_with_a_known_sensitivity()
    {
        var draft = await Build(Reply).Handler.Handle(new DraftDictionaryCommand("view", 9, 7, 1), default);

        draft!.Description.Should().Be("One row per well.");
        draft.Columns.Select(c => c.ColumnName).Should().Equal("well_id", "lift_type", "supervisor_email");
        draft.Columns[0].Sensitivity.Should().Be("public");
        draft.Columns[1].Sensitivity.Should().Be("internal");     // "secret" is not a sensitivity
        draft.Columns[1].Description.Should().Be("How oil is lifted.");
        draft.Columns[2].Sensitivity.Should().Be("pii");
    }

    [Fact]
    public async Task Shows_the_AI_short_distinct_examples_but_none_for_pii_columns_and_at_most_MaxColumns()
    {
        var setup = Build(Reply);
        await setup.Handler.Handle(new DraftDictionaryCommand("view", 9, 7, 1), default);

        var user = setup.Sent.Single().Last().Content;
        user.Should().Contain("- well_id | string | none | NM-010\n");          // cut to 6, then distinct
        user.Should().Contain("- lift_type | string | Lift Type | ESP, PCP");
        user.Should().Contain("supervisor_email").And.Contain("(not shown: marked pii)").And.NotContain("tasnim.om");
        user.Should().NotContain("cost");                                       // past MaxColumns
        setup.Sent.Single().First().Content.Should().StartWith("Document the columns.");
    }

    [Fact]
    public async Task Refuses_when_the_feature_is_off_or_the_reply_cannot_be_read()
    {
        await Build(Reply, featureOn: false).Handler.Invoking(h => h.Handle(new DraftDictionaryCommand("view", 9, 7, 1), default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*not enabled for your role*");
        await Build("sorry, no JSON").Handler.Invoking(h => h.Handle(new DraftDictionaryCommand("view", 9, 7, 1), default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*could not be read*");
    }

    [Fact]
    public async Task A_dataset_that_does_not_exist_is_null_and_one_without_columns_is_refused()
    {
        (await Build(Reply).Handler.Handle(new DraftDictionaryCommand("view", 8, 7, 1), default)).Should().BeNull();
        await Build(Reply, dataset: Dataset with { Columns = [] }).Handler.Invoking(h => h.Handle(new DraftDictionaryCommand("view", 9, 7, 1), default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*no columns*");
    }

    [Fact]
    public void The_validator_takes_import_or_view_only()
    {
        var v = new DraftDictionaryCommandValidator();
        v.Validate(new DraftDictionaryCommand("view", 9, 7, 1)).IsValid.Should().BeTrue();
        v.Validate(new DraftDictionaryCommand("table", 9, 7, 1)).IsValid.Should().BeFalse();
        v.Validate(new DraftDictionaryCommand("import", 0, 7, 1)).IsValid.Should().BeFalse();
    }

    [Fact]
    public void The_settings_have_no_defaults()
    {
        var empty = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var act = () => AiDictionaryOptions.From(empty);
        act.Should().Throw<Exception>().WithMessage("*AiDictionary:SampleRows*");
    }
}
