using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AskDataLinks;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Application.Features.Ai.Knowledge;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Ask Data's learned examples, metrics library and table links (stored as askdata / 0).</summary>
public class AskDataLearningTests
{
    private static IMemoryCache NewCache() => new MemoryCache(new MemoryCacheOptions());

    private static AiDatasetRelation Link(string from, string to, string status) =>
        new() { FromType = "askdata", FromName = from[..from.LastIndexOf('.')], FromColumn = from[(from.LastIndexOf('.') + 1)..],
                ToType = "askdata", ToName = to[..to.LastIndexOf('.')], ToColumn = to[(to.LastIndexOf('.') + 1)..], Status = status };

    [Fact]
    public async Task A_run_gets_metrics_approved_examples_and_confirmed_links_and_they_are_cached()
    {
        var knowledge = new Mock<IAiKnowledgeRepository>();
        knowledge.Setup(k => k.GetMetricsAsync(7, "askdata", 0, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiMetric { Name = "Rig uptime", Agg = "sum", ColumnName = "well.rig_day.uptime_hours" }]);
        knowledge.Setup(k => k.GetExamplesAsync(7, "askdata", 0, It.IsAny<CancellationToken>())).ReturnsAsync([
            new AiExample { Question = "Wells in Nimr?", QuerySpecJson = AskDataSettingsRules.ExampleJson("SELECT 1"), Status = AiExampleStatus.Approved },
            new AiExample { Question = "Not reviewed yet", QuerySpecJson = AskDataSettingsRules.ExampleJson("SELECT 2"), Status = AiExampleStatus.Pending },
        ]);
        knowledge.Setup(k => k.GetRelationsAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync([
            Link("well.task_daily.well_id", "well.well_master.well_id", "confirmed"),
            Link("well.task_daily.crew_no", "ref.crew.crew_no", "suggested"),
            new AiDatasetRelation { FromType = "view", FromId = 3, FromName = "Wells", FromColumn = "id", ToType = "view", ToId = 4, ToName = "Tasks", ToColumn = "well", Status = "confirmed" },
        ]);
        var cache = NewCache();

        var askData = await AskDataSettingsRules.ToRuntime(null).WithKnowledgeAsync(knowledge.Object, cache, 7, default);
        await AskDataSettingsRules.ToRuntime(null).WithKnowledgeAsync(knowledge.Object, cache, 7, default);

        askData.Metrics.Should().ContainSingle().Which.Should().Be(new AgentRuntimeMetric("Rig uptime", "sum", "well.rig_day.uptime_hours", null));
        askData.Examples.Should().Equal(new AgentRuntimeExample("Wells in Nimr?", "SELECT 1"));
        askData.Links.Should().Equal(new AgentRuntimeLink("well.task_daily.well_id", "well.well_master.well_id"));
        knowledge.Verify(k => k.GetRelationsAsync(7, It.IsAny<CancellationToken>()), Times.Once);       // the second run read the cache
    }

    [Fact]
    public async Task A_scan_suggests_new_links_but_never_one_an_admin_already_decided()
    {
        var knowledge = new Mock<IAiKnowledgeRepository>();
        knowledge.Setup(k => k.GetRelationsAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync([Link("well.well_master.well_id", "well.task_daily.well_id", "rejected")]);
        var added = new List<AiDatasetRelation>();
        knowledge.Setup(k => k.AddRelationAsync(It.IsAny<AiDatasetRelation>(), It.IsAny<CancellationToken>()))
            .Callback<AiDatasetRelation, CancellationToken>((r, _) => added.Add(r)).Returns(Task.CompletedTask);
        var settings = new Mock<IAiSettingsRepository>();
        settings.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiSettings { AskDataAllowedSchemas = "[\"well\"]" });
        var runtime = new Mock<IAgentRuntimeClient>();
        runtime.Setup(r => r.AskDataLinksAsync(It.IsAny<AgentRuntimeAskData>(), It.IsAny<CancellationToken>())).ReturnsAsync([
            new AgentRuntimeLinkSuggestion("well.task_daily.well_id", "well.well_master.well_id", null),     // rejected the other way round
            new AgentRuntimeLinkSuggestion("well.task_daily.crew_id", "ref.crew.crew_id", 0.9),
        ]);

        await new ScanAskDataLinksHandler(settings.Object, knowledge.Object, runtime.Object, NewCache()).Handle(new ScanAskDataLinksCommand(7, "a@b.com"), default);

        knowledge.Verify(k => k.RemoveSuggestedRelationsAsync(7, It.Is<IReadOnlyCollection<string>>(x => x.Contains("askdata:0")), It.IsAny<CancellationToken>()));
        added.Should().ContainSingle();
        added[0].Should().BeEquivalentTo(new { FromType = "askdata", FromName = "well.task_daily", FromColumn = "crew_id", ToName = "ref.crew", ToColumn = "crew_id",
                                               Status = "suggested", Overlap = 0.9 });
    }

    [Fact]
    public void Ask_Data_links_and_metrics_name_their_columns_in_full()
    {
        var link = new AddAskDataLinkCommandValidator();
        link.Validate(new AddAskDataLinkCommand(7, "a", new AddAskDataLinkRequest("well.task_daily.well_id", "well.well_master.well_id"))).IsValid.Should().BeTrue();
        link.Validate(new AddAskDataLinkCommand(7, "a", new AddAskDataLinkRequest("well_id", "well.well_master.well_id"))).IsValid.Should().BeFalse();
        link.Validate(new AddAskDataLinkCommand(7, "a", new AddAskDataLinkRequest("a.b.c", "A.B.C"))).IsValid.Should().BeFalse();

        var metrics = new SaveAiDatasetMetricsCommandValidator();
        metrics.Validate(new SaveAiDatasetMetricsCommand(7, "a", "askdata", 0, [new AiMetricDto("Rig uptime", "sum", "well.rig_day.uptime_hours", null)])).IsValid.Should().BeTrue();
        metrics.Validate(new SaveAiDatasetMetricsCommand(7, "a", "askdata", 0, [new AiMetricDto("Rig uptime", "sum", "uptime_hours", null)])).IsValid.Should().BeFalse();
        new GetAiExamplesQueryValidator().Validate(new GetAiExamplesQuery(7, "askdata", 0)).IsValid.Should().BeTrue();

        AskDataSettingsRules.ExampleSql(AskDataSettingsRules.ExampleJson("SELECT 'a'")).Should().Be("SELECT 'a'");
        AskDataSettingsRules.ExampleSql("{\"groupBy\":[\"x\"]}").Should().BeNull();
    }
}
