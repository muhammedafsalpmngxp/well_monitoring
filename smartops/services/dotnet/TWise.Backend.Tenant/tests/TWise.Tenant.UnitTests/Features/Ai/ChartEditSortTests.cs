using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Edit chart by chat: the AI may sort a chart, but only with one of the builder's sort orders.</summary>
public class ChartEditSortTests
{
    private static readonly AiChartState Current = new("bar", "lift_type", "Count (F)", "", "Wells", null, null, true, true, false, false, "all", null, null, false);

    private static async Task<AiChartEditResponse> EditAsync(string aiReply)
    {
        var settings = new Mock<IAiSettingsRepository>();
        settings.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiSettings { IsEnabled = true });
        var grants = new Mock<IAiFeatureRoleRepository>();
        grants.Setup(g => g.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync([new AiFeatureRole { FeatureKey = AiFeatureCatalog.Edit, RoleCode = "admin" }]);
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.Roles).Returns(["admin"]);
        var prompts = new Mock<IAiPromptStore>();
        prompts.Setup(p => p.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<string, string> { [AiPrompts.ChartEdit] = "Edit the chart." });
        var ai = new Mock<IAiService>();
        ai.Setup(a => a.CompleteAsync(7, It.IsAny<string?>(), "edit", It.IsAny<IReadOnlyList<AiMessage>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiCompletion(aiReply, 0, 0));

        var service = new AiAskService(ai.Object, new Mock<IAiConversationRepository>().Object, new Mock<IDatabaseViewService>().Object,
            new Mock<IImportedDatasetService>().Object, new Mock<ISourceService>().Object, new Mock<IAiKnowledgeRepository>().Object,
            settings.Object, grants.Object, user.Object, new Mock<IServiceScopeFactory>().Object, new MemoryCache(new MemoryCacheOptions()),
            new Mock<IAiViewQueryRunner>().Object, new Mock<IAgentRuntimeClient>().Object, new Mock<IAiUsageRepository>().Object,
            prompts.Object, new Mock<IDatabaseConnectionRepository>().Object, new Mock<IAiSummaryRepository>().Object, new AiExplainOptions(), new AiHistoryOptions { SavedRows = 500 });
        return await service.EditChartAsync(new AiChartEditRequest("stacked bar, sorted descending", Current, ["lift_type", "well_id"], ["bar", "stacked"]), 7, 1, default);
    }

    [Fact]
    public async Task A_sort_order_from_the_AI_is_applied_with_the_chart_type()
    {
        var result = await EditAsync("""{"patch":{"chartType":"stacked","sortOrder":"VALUE-DESC"},"message":"Stacked and sorted."}""");

        result.Patch.ChartType.Should().Be("stacked");
        result.Patch.SortOrder.Should().Be("value-desc");
    }

    [Fact]
    public async Task An_unknown_sort_order_is_dropped()
    {
        (await EditAsync("""{"patch":{"sortOrder":"biggest first"},"message":"Sorted."}""")).Patch.SortOrder.Should().BeNull();
    }
}
