using System.Runtime.CompilerServices;
using System.Text.Json;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Agents;

public sealed class AgentScheduleTests
{
    private readonly Mock<IAiAgentRepository> _repo = new();
    private readonly Mock<ISender> _sender = new();
    private readonly Mock<IMailSender> _mail = new();

    private static AiAgent Published(string status = "published", string steps = "[{\"text\":\"Count wells in {{cluster}}\"}]") => new()
    {
        Id = 5, TenantId = 7, Name = "Well Count", Status = status, StepsJson = steps,
        ToolsJson = "[{\"agent\":\"ask_data\",\"action\":\"deep\"}]", InputsJson = "[{\"name\":\"cluster\",\"required\":true}]",
    };

    private AgentScheduleRunner Runner => new(_repo.Object, _sender.Object, _mail.Object, NullLogger<AgentScheduleRunner>.Instance);

    private static async IAsyncEnumerable<AiAskEvent> Stream(AiAskEvent ev, [EnumeratorCancellation] CancellationToken ct = default)
    {
        await Task.Yield();
        yield return ev;
    }

    [Fact]
    public async Task Runner_RunsThePublishedAgent_MailsTheAnswer_AndMovesTheNextRun()
    {
        var s = new AiAgentSchedule { Id = 3, TenantId = 7, AgentId = 5, Cron = "0 6 * * *", TimeZone = "Asia/Muscat",
            InputsJson = "{\"cluster\":\"Nimr\"}", EmailTo = "a@b.com, c@d.com", CreatedBy = "lead@x.com", IsActive = true };
        _repo.Setup(r => r.GetScheduleAsync(null, 3, It.IsAny<CancellationToken>())).ReturnsAsync(s);
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Published());
        TestAiAgentStream? sent = null;
        _sender.Setup(x => x.CreateStream(It.IsAny<TestAiAgentStream>(), It.IsAny<CancellationToken>()))
            .Callback<IStreamRequest<AiAskEvent>, CancellationToken>((r, _) => sent = (TestAiAgentStream)r)
            .Returns(Stream(new AiAskEvent("done", new { runId = 41, ok = true, answer = "393 wells" })));
        MailEnvelope? mail = null;
        _mail.Setup(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>()))
            .Callback<MailEnvelope, CancellationToken>((m, _) => mail = m).ReturnsAsync(new MailResult([]));

        await Runner.RunAsync(3, default);

        sent!.UserName.Should().Be("Schedule · lead@x.com");
        sent.Request.Inputs.Should().Contain("cluster", "Nimr");
        s.LastStatus.Should().Be("success");
        s.LastRunId.Should().Be(41);
        s.NextRunAt.Should().BeAfter(DateTime.UtcNow);
        mail!.To.Should().Equal("a@b.com", "c@d.com");
        mail.Body.Should().StartWith("393 wells");
    }

    [Fact]
    public async Task Runner_RecordsAFailure_WhenTheAgentIsNoLongerPublished_AndAOnceTriggerTurnsOff()
    {
        var s = new AiAgentSchedule { Id = 3, TenantId = 7, AgentId = 5, RunOnceAt = DateTime.UtcNow.AddMinutes(-1), TimeZone = "UTC",
            InputsJson = "{\"cluster\":\"Nimr\"}", IsActive = true };
        _repo.Setup(r => r.GetScheduleAsync(null, 3, It.IsAny<CancellationToken>())).ReturnsAsync(s);
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Published("draft"));

        await Runner.RunAsync(3, default);

        s.LastStatus.Should().Be("failed");
        s.IsActive.Should().BeFalse();
        _sender.Verify(x => x.CreateStream(It.IsAny<IStreamRequest<AiAskEvent>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("draft", "{\"cluster\":\"Nimr\"}", "Publish the agent")]
    [InlineData("published", "{}", "Fill in the inputs: cluster")]
    public async Task Create_RefusesAnAgentThatCannotRunOnASchedule(string status, string inputs, string message)
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Published(status));
        var request = new SaveAiAgentScheduleRequest("0 6 * * *", Inputs: JsonSerializer.Deserialize<Dictionary<string, string>>(inputs));

        var act = () => new CreateAiAgentScheduleHandler(_repo.Object).Handle(new CreateAiAgentScheduleCommand(7, 5, "a@b.com", request), default);

        (await act.Should().ThrowAsync<InvalidOperationException>()).WithMessage($"{message}*");
    }

    [Fact]
    public async Task Create_RefusesAnAgentWithHumanApproval_AndSavesAValidTrigger()
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Published(steps: "[{\"text\":\"Draft\"},{\"text\":\"OK?\",\"tool\":{\"agent\":\"approval\",\"action\":\"review\"}}]"));
        var request = new SaveAiAgentScheduleRequest("0 6 * * 1-5", Inputs: new() { ["cluster"] = "Nimr" });
        var handler = new CreateAiAgentScheduleHandler(_repo.Object);

        await handler.Invoking(h => h.Handle(new CreateAiAgentScheduleCommand(7, 5, "a@b.com", request), default))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*Human Approval*");

        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Published());
        var dto = await handler.Handle(new CreateAiAgentScheduleCommand(7, 5, "a@b.com", request), default);
        dto!.NextRuns.Should().HaveCount(5);
        dto.NextRunAt.Should().Be(dto.NextRuns[0]);
        _repo.Verify(r => r.AddSchedule(It.Is<AiAgentSchedule>(x => x.CreatedBy == "a@b.com" && x.TenantId == 7)), Times.Once);
    }

    [Theory]
    [InlineData("0 6 * * *", "Asia/Muscat", "a@b.com", true)]
    [InlineData("not a cron", "Asia/Muscat", null, false)]
    [InlineData("0 6 * * *", "Mars/Base", null, false)]
    [InlineData("0 6 * * *", "Asia/Muscat", "not-an-email", false)]
    public void Validator_ChecksWhenAndWho(string cron, string zone, string? email, bool valid) =>
        new SaveAiAgentScheduleRequestValidator().Validate(new SaveAiAgentScheduleRequest(cron, null, zone, null, email is null ? null : [email]))
            .IsValid.Should().Be(valid);
}
