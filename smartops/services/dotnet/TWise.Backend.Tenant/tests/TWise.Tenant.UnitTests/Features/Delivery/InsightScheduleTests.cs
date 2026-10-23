using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.Conversations;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Infrastructure.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

/// <summary>A scheduled insight report: an Ask AI answer's report written into a mail, with a link back to the chat.</summary>
public class InsightScheduleTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 3, 0, 0, DateTimeKind.Utc);
    // An owner with the schedules page only: an insight needs no other page module.
    private static readonly DirectoryUser Owner = new(5, "owner@tasnim.om", "Owner", true, ["planner"], [], ["smart-alerts.schedules"]);

    private static readonly AiInsightReportDto Report = new("Downtime by month", "Ask your data", 12,
        ["Downtime rose 18% from Jan-26 to Sep-26."], ["March is the peak with 410 h."], [], ["Check the March rig moves."]);

    private static Schedule Insight(string body = "Hello") => new()
    {
        Id = 4, TenantId = 1, Name = "Monday downtime", TargetType = DeliveryTerms.Insight, TargetId = 910, Format = DeliveryTerms.Link,
        Cron = "0 8 * * 1", TimeZone = "Asia/Muscat", Subject = "{{item}}", Body = body, OwnerUserId = 5, IsActive = true,
        Recipients = [new ScheduleRecipient { Kind = "To", RecipientType = "Email", Value = "ops@tasnim.om" }],
    };

    private static ScheduleRequest Request(string format) => new(
        "Monday downtime", DeliveryTerms.Insight, 910, format, "0 8 * * 1", null, "Asia/Muscat", null, null, false,
        "{{item}}", "Hello", [new RecipientDto("To", "Email", "ops@tasnim.om")]);

    [Fact]
    public void The_report_text_lists_each_section_that_has_lines()
    {
        var text = InsightReportText.Format(Report);

        text.Should().StartWith("Downtime by month\nAsk your data · 12 rows");
        text.Should().Contain("Trend\n- Downtime rose 18% from Jan-26 to Sep-26.");
        text.Should().Contain("Key findings\n- March is the peak with 410 h.");
        text.Should().Contain("Recommendations\n- Check the March rig moves.");
        text.Should().NotContain("Unusual");
    }

    [Fact]
    public void An_insight_goes_as_a_link_with_no_page_module_and_other_formats_are_refused()
    {
        ScheduleRules.Problem(Request(DeliveryTerms.Link), Now).Should().BeNull();
        ScheduleRules.Problem(Request(DeliveryTerms.Xlsx), Now).Should().Contain("insight can be sent as Link");
        ScheduleRules.CanView(DeliveryTerms.Insight, _ => false).Should().BeTrue();
        ScheduleRules.CanView(DeliveryTerms.Report, _ => false).Should().BeFalse();
    }

    [Fact]
    public void An_insight_links_to_its_answer()
    {
        DeliveryLinks.For("https://twise.example/", DeliveryTerms.Insight, 910).Should().Be("https://twise.example/ask-ai/answers/910");
    }

    [Theory]
    [InlineData("Hello", "Hello\n\nDowntime by month")]
    [InlineData("Hello\n\n{{report}}\n\nRegards", "Hello\n\nDowntime by month")]
    public async Task The_report_goes_where_the_token_is_or_after_the_message(string body, string starts)
    {
        var sent = new List<MailEnvelope>();
        var directory = new Mock<IRecipientResolver>();
        directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([Owner]);
        var renderer = new Mock<IDeliveryRenderer>();
        renderer.SetupGet(r => r.TargetType).Returns(DeliveryTerms.Insight);
        renderer.Setup(r => r.RenderAsync(It.IsAny<Schedule>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RenderedDelivery("Downtime by month", "http://app/ask-ai/answers/910", false, [], Text: InsightReportText.Format(Report)));
        var mail = new Mock<IMailSender>();
        mail.Setup(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>()))
            .Callback((MailEnvelope e, CancellationToken _) => sent.Add(e)).ReturnsAsync(new MailResult([]));
        var runner = new DeliveryRunner(new Mock<IScheduleStore>().Object, new Mock<IMailGroupStore>().Object, directory.Object,
            [renderer.Object], mail.Object, NullLogger<DeliveryRunner>.Instance);

        var run = await runner.RunAsync(Insight(body), DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be(DeliveryTerms.Sent);
        sent.Single().Body.Should().StartWith(starts);
        sent.Single().Body.Should().Contain("Recommendations\n- Check the March rig moves.");
        sent.Single().Body.Should().Contain("http://app/ask-ai/answers/910");
        sent.Single().Subject.Should().Be("Downtime by month");
    }

    [Fact]
    public async Task The_renderer_builds_the_report_as_the_owner_and_says_why_it_cannot()
    {
        var ask = new Mock<IAiAskService>();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["App:PublicBaseUrl"] = "https://twise.example" }).Build();
        var renderer = new InsightDeliveryRenderer(ask.Object, config);

        ask.Setup(a => a.ReportAsync(910, 1, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Report);
        var rendered = await renderer.RenderAsync(Insight(), default);
        rendered.TargetName.Should().Be("Downtime by month");
        rendered.Link.Should().Be("https://twise.example/ask-ai/answers/910");
        rendered.Text.Should().Contain("Key findings");
        rendered.IsEmpty.Should().BeFalse();

        ask.Setup(a => a.ReportAsync(910, 1, 5, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("A report needs an answer with at least 3 groups."));
        await renderer.Invoking(r => r.RenderAsync(Insight(), default)).Should().ThrowAsync<DeliveryException>().WithMessage("*at least 3 groups*");

        ask.Setup(a => a.ReportAsync(910, 1, 5, It.IsAny<CancellationToken>())).ReturnsAsync((AiInsightReportDto?)null);
        await renderer.Invoking(r => r.RenderAsync(Insight(), default)).Should().ThrowAsync<DeliveryException>().WithMessage("*no longer exists*");
    }

    [Fact]
    public async Task The_mail_link_opens_only_the_owner_s_chat()
    {
        var conversations = new Mock<IAiConversationRepository>();
        conversations.Setup(c => c.GetMessageAsync(910, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiChatMessage { Id = 910, ConversationId = 3, Role = "assistant", Content = "March leads." });
        conversations.Setup(c => c.GetAsync(3, 1, "5", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiConversation { Id = 3, TenantId = 1, UserId = "5", SourceType = "askdata", SourceName = "Ask your data", Title = "Downtime" });
        conversations.Setup(c => c.GetMessagesAsync(3, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiChatMessage { Id = 910, Role = "assistant", Content = "March leads." }]);
        var handler = new GetAiConversationByMessageHandler(conversations.Object);

        (await handler.Handle(new GetAiConversationByMessageQuery(1, 5, 910), default))!.Conversation.Id.Should().Be(3);
        (await handler.Handle(new GetAiConversationByMessageQuery(1, 6, 910), default)).Should().BeNull();
        (await handler.Handle(new GetAiConversationByMessageQuery(1, 5, 999), default)).Should().BeNull();
    }
}
