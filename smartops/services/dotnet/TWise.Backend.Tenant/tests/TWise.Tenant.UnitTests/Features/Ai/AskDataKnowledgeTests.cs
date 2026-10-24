using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Application.Features.Ai.Knowledge;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Ask Data's business terms and column names (stored as askdata / 0) and its suggested first questions.</summary>
public class AskDataKnowledgeTests
{
    [Fact]
    public void Ask_Data_terms_and_notes_use_askdata_with_id_0_and_name_columns_in_full()
    {
        new GetAiDatasetTermsQueryValidator().Validate(new GetAiDatasetTermsQuery(7, "askdata", 0)).IsValid.Should().BeTrue();
        new GetAiDatasetTermsQueryValidator().Validate(new GetAiDatasetTermsQuery(7, "askdata", 3)).IsValid.Should().BeFalse();
        new GetAiDatasetNotesQueryValidator().Validate(new GetAiDatasetNotesQuery(7, "view", 3)).IsValid.Should().BeTrue();

        var notes = new SaveAiDatasetNotesCommandValidator();
        notes.Validate(Notes("well.well_master.bl_flaf_scr", "ref.crew")).IsValid.Should().BeTrue();
        notes.Validate(Notes("bl_flaf_scr")).Errors.Should().ContainSingle().Which.ErrorMessage.Should().Contain("schema.table.column");

        var terms = new SaveAiDatasetTermsCommandValidator();
        terms.Validate(Terms("well.well_master.cluster")).IsValid.Should().BeTrue();
        terms.Validate(Terms("well.well_master")).IsValid.Should().BeFalse();       // a filter needs a column
    }

    [Fact]
    public async Task Every_Ask_Data_run_gets_the_terms_and_column_names()
    {
        var knowledge = new Mock<IAiKnowledgeRepository>();
        knowledge.Setup(k => k.GetTermsAsync(7, "askdata", 0, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiTerm { Term = "NPT", Synonyms = "downtime, lost time", Meaning = "hours where category = 'Non-productive'" }]);
        knowledge.Setup(k => k.GetNotesAsync(7, "askdata", 0, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiDatasetNote { ColumnName = "well.well_master.bl_flaf_scr", DisplayName = "FLAF Score", Note = "" },
                           new AiDatasetNote { ColumnName = null, Note = "dataset-level notes are not used by Ask Data" }]);

        var askData = await AskDataSettingsRules.ToRuntime(null).WithKnowledgeAsync(knowledge.Object, NewCache(), 7, default);

        askData.Terms.Should().ContainSingle().Which.Synonyms.Should().Equal("downtime", "lost time");
        askData.Notes.Should().ContainSingle().Which.Should().Be(new AgentRuntimeColumnNote("well.well_master.bl_flaf_scr", "FLAF Score", null));
    }

    [Fact]
    public async Task Starters_need_Ask_your_data_and_never_fail_the_panel()
    {
        var ask = new Mock<IAiAskService>();
        var settings = new Mock<IAiSettingsRepository>();
        settings.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiSettings { AskDataAllowedSchemas = "[\"well\"]" });
        var runtime = new Mock<IAgentRuntimeClient>();
        var handler = new GetAskDataStartersHandler(ask.Object, settings.Object, new Mock<IAiKnowledgeRepository>().Object, runtime.Object, NewCache(),
            Prompts(""));                                                                        // no list of its own: Ask Data suggests

        (await handler.Handle(new GetAskDataStartersQuery(7), default)).Should().BeEmpty();          // feature off
        runtime.Verify(r => r.AskDataStartersAsync(It.IsAny<AgentRuntimeAskData>(), It.IsAny<CancellationToken>()), Times.Never);

        ask.Setup(a => a.FeatureOnAsync(7, AiFeatureCatalog.Ask, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        runtime.Setup(r => r.AskDataStartersAsync(It.Is<AgentRuntimeAskData>(a => a.AllowedSchemas.Contains("well")), It.IsAny<CancellationToken>()))
            .ReturnsAsync(["How many wells are there by lift type?"]);
        (await handler.Handle(new GetAskDataStartersQuery(7), default)).Should().Equal("How many wells are there by lift type?");

        runtime.Setup(r => r.AskDataStartersAsync(It.IsAny<AgentRuntimeAskData>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("down"));
        (await handler.Handle(new GetAskDataStartersQuery(7), default)).Should().BeEmpty();
    }

    [Fact]
    public async Task The_admins_suggested_questions_are_shown_instead_of_the_automatic_ones()
    {
        var ask = new Mock<IAiAskService>();
        ask.Setup(a => a.FeatureOnAsync(7, AiFeatureCatalog.Ask, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var runtime = new Mock<IAgentRuntimeClient>();
        var handler = new GetAskDataStartersHandler(ask.Object, new Mock<IAiSettingsRepository>().Object, new Mock<IAiKnowledgeRepository>().Object,
            runtime.Object, NewCache(), Prompts("How many wells are there in each cluster?\nWhich wells are due next month?"));

        (await handler.Handle(new GetAskDataStartersQuery(7), default)).Should()
            .Equal("How many wells are there in each cluster?", "Which wells are due next month?");
        runtime.Verify(r => r.AskDataStartersAsync(It.IsAny<AgentRuntimeAskData>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static IAiPromptStore Prompts(string starters)
    {
        var store = new Mock<IAiPromptStore>();
        store.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string> { [AiPrompts.AskDataStarters] = starters });
        return store.Object;
    }

    private static Microsoft.Extensions.Caching.Memory.IMemoryCache NewCache() =>
        new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());

    private static SaveAiDatasetNotesCommand Notes(params string[] columns) =>
        new(7, "a@b.com", "askdata", 0, columns.Select(c => new AiDatasetNoteDto(c, "", "Name")).ToList());

    private static SaveAiDatasetTermsCommand Terms(string column) =>
        new(7, "a@b.com", "askdata", 0, [new AiTermDto("dry well", null, column, "Dry", null)]);
}
