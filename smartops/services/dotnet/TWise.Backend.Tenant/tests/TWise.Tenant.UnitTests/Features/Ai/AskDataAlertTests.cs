using Microsoft.Extensions.Logging.Abstractions;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Alerts on Ask Data answers (watched through their checked SQL), limits from settings, and the bell opening the alert.</summary>
public class AskDataAlertTests
{
    private const string Sql = "SELECT wm.lift_type, COUNT(DISTINCT wm.well_id) AS well_count FROM well.well_master AS wm GROUP BY wm.lift_type";

    private static AiAlertOptions Options(int maxEmails = 10) => new()
    {
        Enabled = true, PollSeconds = 300, BatchSize = 20, MaxEmails = maxEmails, EveryHours = [1, 24, 168], DefaultEveryHours = 24,
        MaxHistory = 30, MinHistory = 5, MaxListed = 5, NoticeHistory = 5, UnusualScore = 3.5,
    };

    private static AiQueryResult Rows(params (string lift, double wells)[] rows) =>
        new(["lift_type", "well_count"], rows.Select(r => new Dictionary<string, object?> { ["lift_type"] = r.lift, ["well_count"] = r.wells }).ToList(), rows.Length, 100, false);

    private sealed record Setup(AiAlertService Service, Mock<IAiAlertRepository> Alerts, Mock<IAiAskService> Ask, Mock<IControlPlaneNotificationClient> Bell, List<AiAlert> Added);

    private static Setup Build(AiQueryResult result, int maxEmails = 10)
    {
        var conversations = new Mock<IAiConversationRepository>();
        conversations.Setup(c => c.GetMessageAsync(9, It.IsAny<CancellationToken>())).ReturnsAsync(new AiChatMessage { Id = 9, ConversationId = 3, Role = "assistant", Content = "…" });
        conversations.Setup(c => c.GetAsync(3, 7, "1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiConversation { Id = 3, TenantId = 7, UserId = "1", SourceType = AiSources.AskData, SourceName = "Ask your data", Title = "Wells" });
        conversations.Setup(c => c.GetMessagesAsync(3, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiChatMessage { Id = 8, Role = "user", Content = "How many wells by lift type?" }]);
        var ask = new Mock<IAiAskService>();
        ask.Setup(a => a.FeatureOnAsync(7, AiFeatureCatalog.Alerts, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        ask.Setup(a => a.AskDataSqlAsync(9, It.IsAny<CancellationToken>())).ReturnsAsync(Sql);
        ask.Setup(a => a.RunAskDataAsync(Sql, 7, It.IsAny<CancellationToken>())).ReturnsAsync(() => (AskDataInsights.WatchSpec(Sql, result), result));
        var alerts = new Mock<IAiAlertRepository>();
        var added = new List<AiAlert>();
        alerts.Setup(a => a.Add(It.IsAny<AiAlert>())).Callback<AiAlert>(x => { x.Id = 41; added.Add(x); });
        alerts.Setup(a => a.GetAsync(41, 7, "1", It.IsAny<CancellationToken>())).ReturnsAsync(() => added.FirstOrDefault());
        var bell = new Mock<IControlPlaneNotificationClient>();
        var ai = new Mock<IAiService>();
        ai.Setup(a => a.CompleteAsync(7, It.IsAny<string?>(), "alert", It.IsAny<IReadOnlyList<AiMessage>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("AI is off"));               // the notice falls back to the checked result
        var service = new AiAlertService(alerts.Object, conversations.Object, ask.Object, new Mock<IRecipientResolver>().Object, bell.Object,
            new Mock<IMailSender>().Object, ai.Object, new Mock<IAiPromptStore>().Object, new Mock<IAiKnowledgeRepository>().Object,
            Options(maxEmails), NullLogger<AiAlertService>.Instance);
        return new Setup(service, alerts, ask, bell, added);
    }

    [Fact]
    public void An_Ask_Data_answer_is_watched_by_its_groups_else_its_number_else_its_rows()
    {
        AskDataInsights.WatchSpec(Sql, Rows(("PCP", 294), ("ESP", 52))).GroupBy.Should().Equal("lift_type");
        var single = AskDataInsights.WatchSpec("SELECT COUNT(*) AS wells FROM well.well_master",
            new AiQueryResult(["wells"], [new Dictionary<string, object?> { ["wells"] = 841.0 }], 1, 100, false));
        single.GroupBy.Should().BeEmpty();
        single.Measures.Should().ContainSingle().Which.Column.Should().Be("wells");
        AskDataInsights.WatchSpec("SELECT name FROM ref.crew", new AiQueryResult(["name"], [new Dictionary<string, object?> { ["name"] = "A" }], 1, 100, false))
            .Measures.Should().BeEmpty();                                           // no number: the number of rows is watched
    }

    [Fact]
    public async Task An_Ask_Data_answer_can_be_watched_through_its_checked_SQL()
    {
        var s = Build(Rows(("PCP", 294), ("ESP", 52), ("BP", 14)));

        var dto = await s.Service.CreateAsync(new CreateAiAlertRequest(9, "above", 100, 24), 7, 1, default);

        dto.Should().NotBeNull();
        dto!.SourceType.Should().Be(AiSources.AskData);
        AskDataSettingsRules.ExampleSql(s.Added.Single().QuerySpecJson).Should().Be(Sql);   // the SQL is what is checked again
        dto.IsTriggered.Should().BeTrue();
        dto.LastMessage.Should().Contain("1 of 3 groups above 100").And.Contain("PCP (294)");
        s.Bell.Verify(b => b.PublishAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
            It.IsAny<IReadOnlyList<long>>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);   // the first check never notifies
    }

    [Fact]
    public async Task Change_watching_is_refused_for_a_grouped_Ask_Data_answer_before_anything_is_saved()
    {
        var s = Build(Rows(("PCP", 294), ("ESP", 52)));

        var act = () => s.Service.CreateAsync(new CreateAiAlertRequest(9, "change", 10, 24), 7, 1, default);

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("*single-number answer*");
        s.Added.Should().BeEmpty();
    }

    [Fact]
    public async Task The_e_mail_limit_and_check_intervals_come_from_settings()
    {
        var s = Build(Rows(("PCP", 294)), maxEmails: 2);

        await s.Service.Invoking(x => x.CreateAsync(new CreateAiAlertRequest(9, "above", 1, 24, "a@x.com, b@x.com, c@x.com"), 7, 1, default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("At most 2 e-mail addresses.");
        await s.Service.Invoking(x => x.CreateAsync(new CreateAiAlertRequest(9, "above", 1, 12), 7, 1, default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*offered check intervals*");
    }

    [Fact]
    public async Task When_an_alert_starts_firing_the_bell_opens_that_alert()
    {
        var result = Rows(("PCP", 50));
        var s = Build(result);
        await s.Service.CreateAsync(new CreateAiAlertRequest(9, "above", 100, 24), 7, 1, default);   // not firing yet
        s.Ask.Setup(a => a.RunAskDataAsync(Sql, 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => (AskDataInsights.WatchSpec(Sql, Rows(("PCP", 294))), Rows(("PCP", 294))));

        var dto = await s.Service.CheckAsync(41, 7, 1, default);

        dto!.IsTriggered.Should().BeTrue();
        s.Bell.Verify(b => b.PublishAsync(7, "AiAlert", It.IsAny<string>(), It.Is<string?>(t => t!.Contains("294")), "/ask-ai/alerts/41",
            It.Is<IReadOnlyList<long>>(r => r.SequenceEqual(new long[] { 1 })), null, It.IsAny<CancellationToken>()));
    }
}
