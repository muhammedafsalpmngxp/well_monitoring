using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.Activity;
using TWise.Tenant.Application.Features.Ai.Settings;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>AI administration: settings with no defaults in code, the quota warning, AI Activity periods and provider defaults.</summary>
public class AiAdminTests
{
    private static readonly string[] Kinds = ["openai", "ollama"];

    private static Dictionary<string, string?> Settings() => new()
    {
        ["AiAdmin:AdminRoles:0"] = "admin", ["AiAdmin:DefaultDailyQuota"] = "500", ["AiAdmin:QuotaWarnPercent"] = "80",
["AiAdmin:UsageDays"] = "14", ["AiAdmin:ActivityDays"] = "7", ["AiAdmin:MaxDays"] = "90",
        ["AiAdmin:DayOptions:0"] = "1", ["AiAdmin:DayOptions:1"] = "7", ["AiAdmin:PageSize"] = "50", ["AiAdmin:MaxPageSize"] = "200",
        ["AiAdmin:AnswerPreviewLength"] = "300", ["AiAdmin:TraceRetentionDays"] = "30", ["AiAdmin:ChatTimeoutSeconds"] = "60",
        ["AiAdmin:Providers:openai:Label"] = "OpenAI", ["AiAdmin:Providers:openai:BaseUrl"] = "https://api.openai.com/v1",
        ["AiAdmin:Providers:openai:Model"] = "gpt-4o-mini", ["AiAdmin:Providers:openai:NeedsKey"] = "true",
        ["AiAdmin:Providers:ollama:Label"] = "Ollama", ["AiAdmin:Providers:ollama:BaseUrl"] = "http://localhost:11434/v1",
        ["AiAdmin:Providers:ollama:Model"] = "llama3.1", ["AiAdmin:Providers:ollama:NeedsKey"] = "false",
    };

    private static AiAdminOptions Options(Action<Dictionary<string, string?>>? change = null)
    {
        var values = Settings();
        change?.Invoke(values);
        return AiAdminOptions.From(new ConfigurationBuilder().AddInMemoryCollection(values).Build(), Kinds);
    }

    [Fact]
    public void The_settings_are_read_from_configuration_and_a_missing_one_stops_startup_with_its_name()
    {
        var o = Options();
        o.DefaultDailyQuota.Should().Be(500);
        o.Providers["ollama"].Should().Be(new AiProviderDefault("Ollama", "http://localhost:11434/v1", "llama3.1", false));

        FluentActions.Invoking(() => Options(v => v.Remove("AiAdmin:PageSize")))
            .Should().Throw<InvalidOperationException>().WithMessage("AiAdmin:PageSize must be set*");
        FluentActions.Invoking(() => Options(v => v.Remove("AiAdmin:Providers:ollama:Label")))
            .Should().Throw<InvalidOperationException>().WithMessage("AiAdmin:Providers:ollama:Label must be set*");
        FluentActions.Invoking(() => Options(v => v["AiAdmin:ActivityDays"] = "120"))
            .Should().Throw<InvalidOperationException>().WithMessage("*must not exceed MaxDays*");
    }

    [Theory]
    [InlineData(78, false)]
    [InlineData(79, true)]      // this call is the 80th of 100: the warning goes out once
    [InlineData(80, false)]
    public async Task The_call_that_reaches_the_warning_level_warns_the_AI_admins_once(int usedBefore, bool warns)
    {
        var settings = new Mock<IAiSettingsRepository>();
        settings.Setup(s => s.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiSettings { IsEnabled = true });
        var providers = new Mock<IAiProviderRepository>();
        providers.Setup(p => p.GetActiveAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiProvider { Model = "m", DailyQuota = 100 });
        var usage = new Mock<IAiUsageRepository>();
        usage.Setup(u => u.CountTodayAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(usedBefore);
        var client = new Mock<IAiChatClient>();
        client.Setup(c => c.CompleteAsync(It.IsAny<AiProvider>(), It.IsAny<string?>(), It.IsAny<IReadOnlyList<AiMessage>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiCompletion("ok", 1, 1));
        var bell = new Mock<IControlPlaneNotificationClient>();
        var directory = new Mock<IRecipientResolver>();
        directory.Setup(d => d.ResolveAsync(7, It.Is<IReadOnlyCollection<long>>(i => i.Count == 0), It.Is<IReadOnlyCollection<string>>(r => r.Contains("admin")), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DirectoryUser(3, "a@x.com", "Admin", true, ["admin"], []), new DirectoryUser(4, "b@x.com", "Gone", false, ["admin"], [])]);
        var service = new AiService(settings.Object, providers.Object, usage.Object, client.Object, new Mock<IAiKeyProtector>().Object,
            Options(), bell.Object, directory.Object, NullLogger<AiService>.Instance);

        await service.CompleteAsync(7, "1", "ask", [new AiMessage("user", "hi")], default);

        bell.Verify(b => b.PublishAsync(7, "AiQuota", It.Is<string>(t => t.Contains("80%")), It.Is<string?>(d => d!.Contains("80 of 100")),
            "/settings/ai/providers", It.Is<IReadOnlyList<long>>(r => r.SequenceEqual(new long[] { 3 })), null, It.IsAny<CancellationToken>()),
            warns ? Times.Once() : Times.Never());                                                    // active AI admins only
    }

    [Fact]
    public async Task AI_calls_default_to_the_settings_period_and_page_size_and_refuse_a_period_that_is_too_long()
    {
        var usage = new Mock<IAiUsageRepository>();
        usage.Setup(u => u.SearchAsync(7, It.IsAny<DateTime>(), It.IsAny<DateTime>(), null, null, true, null, 0, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((0, []));
        usage.Setup(u => u.FacetsAsync(7, It.IsAny<DateTime>(), It.IsAny<DateTime>(), It.IsAny<CancellationToken>())).ReturnsAsync((["5"], ["ask", "summary"]));
        var directory = new Mock<IRecipientResolver>();
        directory.Setup(d => d.ResolveAsync(7, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DirectoryUser(5, "ana@x.com", "Ana", true, [], [])]);
        var handler = new GetAiCallsHandler(usage.Object, directory.Object, Options());

        var page = await handler.Handle(new GetAiCallsQuery(7, null, null, null, null, true, null, 0, null), default);

        page.Purposes.Should().Equal("ask", "summary");
        page.Users.Should().ContainSingle().Which.Should().Be(new AiActivityUserDto("5", "Ana"));
        var today = DateTime.UtcNow.Date;
        usage.Verify(u => u.SearchAsync(7, today.AddDays(-6), today.AddDays(1), null, null, true, null, 0, 50, It.IsAny<CancellationToken>()));
        await handler.Invoking(h => h.Handle(new GetAiCallsQuery(7, new DateOnly(2026, 1, 1), new DateOnly(2026, 6, 1), null, null, false, null, 0, null), default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*at most 90 days*");
    }

    [Fact]
    public async Task A_new_provider_starts_with_the_settings_quota_and_the_key_rule_comes_from_settings()
    {
        var providers = new Mock<IAiProviderRepository>();
        providers.Setup(p => p.ListAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync([]);
        AiProvider? saved = null;
        providers.Setup(p => p.AddAsync(It.IsAny<AiProvider>(), It.IsAny<CancellationToken>())).Callback<AiProvider, CancellationToken>((p, _) => saved = p);
        var handler = new SaveAiProviderHandler(providers.Object, new Mock<IAiKeyProtector>().Object, Options());

        await handler.Handle(new SaveAiProviderCommand(7, "1", null, new SaveAiProviderRequest("Local", "ollama", "http://localhost:11434/v1", "llama3.1", null)), default);
        saved!.DailyQuota.Should().Be(500);                                                   // AiAdmin:DefaultDailyQuota

        await handler.Invoking(h => h.Handle(new SaveAiProviderCommand(7, "1", null, new SaveAiProviderRequest("Cloud", "openai", "https://api.openai.com/v1", "gpt-4o-mini", null)), default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("An API key is required*");   // openai NeedsKey: true
    }
}
