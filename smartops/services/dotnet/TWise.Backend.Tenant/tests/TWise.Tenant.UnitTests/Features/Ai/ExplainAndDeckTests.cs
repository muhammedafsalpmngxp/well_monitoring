using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.Deck;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Explain the dashboard (kept until the data changes) and the AI deck's Key figures (only numbers found in the data).</summary>
public class ExplainAndDeckTests
{
    // The chart as the browser sends it: the values arrive as JSON numbers.
    private static readonly AiSummaryRequest Wells = new("Wells by lift type", ["lift_type", "wells"],
        JsonSerializer.Deserialize<List<Dictionary<string, object?>>>(
            """[{"lift_type":"ESP","wells":52},{"lift_type":"PCP","wells":294},{"lift_type":"BP","wells":14},{"lift_type":"WI","wells":99},{"lift_type":"OP","wells":23}]""")!, null);

    private static readonly AiExplainOptions Explain = new()
    {
        ChartRows = 200, DashboardCharts = 12, DashboardRowsPerChart = 60, SummaryMemoryMinutes = 60, SummaryUnusedDays = 30, DeckKeyFigures = 6,
    };

    private static Mock<IAiService> Ai(string reply)
    {
        var ai = new Mock<IAiService>();
        ai.Setup(a => a.CompleteAsync(7, It.IsAny<string?>(), "deck", It.IsAny<IReadOnlyList<AiMessage>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiCompletion(reply, 0, 0));
        return ai;
    }

    private static Mock<IAiPromptStore> Prompts()
    {
        var prompts = new Mock<IAiPromptStore>();
        prompts.Setup(p => p.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<string, string>
        {
            [AiPrompts.Deck] = "Write a deck.", [AiPrompts.DeckKeyFigures] = "Up to {MAX} key figures.", [AiPrompts.DashboardSummary] = "Summarise the dashboard.",
        });
        return prompts;
    }

    [Fact]
    public async Task The_deck_keeps_only_key_figures_found_in_the_data()
    {
        var ask = new Mock<IAiAskService>();
        ask.Setup(a => a.FeatureOnAsync(7, AiFeatureCatalog.Summary, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var ai = Ai("""
            {"headline":"PCP leads","keyFigures":[
              {"label":"PCP wells","value":"294","note":"the largest group"},
              {"label":"PCP share","value":"61%"},
              {"label":"All wells","value":"482 wells"},
              {"label":"Rounded total","value":"0.5k"},
              {"label":"Invented","value":"999"},
              {"label":"Wrong share","value":"70%"},
              {"label":"No number","value":"many"}],
             "slides":[{"title":"Lift types","bullets":["PCP has 294 wells"],"takeaway":"Focus on PCP"}],"closing":"Done."}
            """);

        var deck = await new BuildAiDeckHandler(ai.Object, ask.Object, Prompts().Object, Explain)
            .Handle(new BuildAiDeckCommand(new AiDeckRequest("Wells", [Wells]), 7, 1), default);

        deck.KeyFigures.Select(f => f.Value).Should().Equal("294", "61%", "482 wells", "0.5k");   // 294 / 482 = 61.0%; 482 ≈ 0.5k
        deck.KeyFigures[0].Note.Should().Be("the largest group");
        deck.Slides.Should().ContainSingle().Which.Bullets.Should().Equal("PCP has 294 wells");
        ai.Verify(a => a.CompleteAsync(7, It.IsAny<string?>(), "deck",
            It.Is<IReadOnlyList<AiMessage>>(m => m[0].Content.Contains("Up to 6 key figures.")), It.IsAny<CancellationToken>()));   // the limit comes from settings
    }

    [Fact]
    public async Task A_stored_dashboard_summary_is_reused_without_asking_the_AI_until_the_data_changes()
    {
        var settings = new Mock<IAiSettingsRepository>();
        settings.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiSettings { IsEnabled = true });
        var grants = new Mock<IAiFeatureRoleRepository>();
        grants.Setup(g => g.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync([new AiFeatureRole { FeatureKey = AiFeatureCatalog.Summary, RoleCode = "admin" }]);
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.Roles).Returns(["admin"]);
        var ai = new Mock<IAiService>();
        var summaries = new Mock<IAiSummaryRepository>();
        string? storedHash = null;
        summaries.Setup(s => s.GetAsync(7, "dashboard", It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string, CancellationToken>((_, _, h, _) => storedHash ??= h)
            .ReturnsAsync((long _, string _, string h, CancellationToken _) => h == storedHash ? "PCP leads with 294 wells." : null);
        var service = new AiAskService(ai.Object, new Mock<IAiConversationRepository>().Object, new Mock<IDatabaseViewService>().Object,
            new Mock<IImportedDatasetService>().Object, new Mock<ISourceService>().Object, new Mock<IAiKnowledgeRepository>().Object,
            settings.Object, grants.Object, user.Object, new Mock<IServiceScopeFactory>().Object, new MemoryCache(new MemoryCacheOptions()),
            new Mock<IAiViewQueryRunner>().Object, new Mock<IAgentRuntimeClient>().Object, new Mock<IAiUsageRepository>().Object,
            Prompts().Object, new Mock<IDatabaseConnectionRepository>().Object, summaries.Object, Explain);

        var events = new List<AiAskEvent>();
        await foreach (var ev in service.SummarizeDashboardAsync(new AiDashboardSummaryRequest("Wells", [Wells]), 7, 1, default)) events.Add(ev);

        events.Select(e => e.Type).Should().Equal("answer", "done");
        events[0].Data.Should().Be("PCP leads with 294 wells.");
        ai.VerifyNoOtherCalls();                                                       // nothing was asked of the AI

        // One more well: a different payload, so it is not the stored summary any more.
        var changed = Wells with { Rows = [.. Wells.Rows.Take(4), new Dictionary<string, object?> { ["lift_type"] = "OP", ["wells"] = 24 }] };
        string? secondHash = null;
        summaries.Setup(s => s.GetAsync(7, "dashboard", It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<long, string, string, CancellationToken>((_, _, h, _) => secondHash = h).ReturnsAsync("other");
        await foreach (var _ in service.SummarizeDashboardAsync(new AiDashboardSummaryRequest("Wells", [changed]), 7, 1, default)) { }
        secondHash.Should().NotBe(storedHash);
    }
}
