using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.Entities.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class DeliveryRunnerTests
{
    private static readonly DateTime Now = new(2026, 9, 28, 3, 0, 0, DateTimeKind.Utc);
    private static readonly DirectoryUser Owner = new(5, "owner@tasnim.om", "Owner", true, ["planner"], [101], ["smart-alerts.schedules", "reports.my-reports"]);

    private readonly Mock<IScheduleStore> _store = new();
    private readonly Mock<IMailGroupStore> _groups = new();
    private readonly Mock<IRecipientResolver> _directory = new();
    private readonly Mock<IDeliveryRenderer> _renderer = new();
    private readonly Mock<IMailSender> _mail = new();
    private readonly List<MailEnvelope> _sent = [];
    private readonly List<TimeSpan> _waits = [];
    private readonly List<ScheduleRun> _runs = [];
    private DirectoryUser? _renderedAs;

    public DeliveryRunnerTests()
    {
        _directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((long _, IReadOnlyCollection<long> ids, IReadOnlyCollection<string> roles, CancellationToken _) =>
                new[] { Owner, new DirectoryUser(6, "Ana@Tasnim.om", "Ana", true, ["viewer"], []), new DirectoryUser(7, "gone@tasnim.om", "Gone", false, ["viewer"], []) }
                    .Where(u => ids.Contains(u.UserId) || u.RoleCodes.Any(roles.Contains)).ToList());
        _renderer.SetupGet(r => r.TargetType).Returns("Report");
        _renderer.Setup(r => r.RenderAsync(It.IsAny<Schedule>(), It.IsAny<CancellationToken>()))
            .Callback(() => _renderedAs = RunAsScope.User)
            .ReturnsAsync(new RenderedDelivery("Wells", "http://app/reports/view/9", false, [new MailAttachment("Wells.xlsx", "application/x", new byte[10])]));
        _mail.Setup(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>()))
            .Callback((MailEnvelope e, CancellationToken _) => _sent.Add(e))
            .ReturnsAsync(new MailResult([]));
        _groups.Setup(g => g.MembersAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, IReadOnlyList<string>> { [3] = ["team@tasnim.om", "OWNER@tasnim.om"] });
        _store.Setup(s => s.AddRunAsync(It.IsAny<ScheduleRun>(), It.IsAny<CancellationToken>()))
            .Callback((ScheduleRun r, CancellationToken _) => _runs.Add(r)).Returns(Task.CompletedTask);
    }

    private DeliveryRunner Runner() => new(_store.Object, _groups.Object, _directory.Object, [_renderer.Object], _mail.Object,
        NullLogger<DeliveryRunner>.Instance)
    {
        Delay = (wait, _) => { _waits.Add(wait); return Task.CompletedTask; },
    };

    private static Schedule Schedule(params ScheduleRecipient[] recipients) => new()
    {
        Id = 9, TenantId = 1, Name = "Weekly wells", TargetType = "Report", TargetId = 9, Format = "Xlsx", Cron = "0 7 * * *",
        TimeZone = "Asia/Muscat", Subject = "{{item}} on {{run_date}}", Body = "Hello", OwnerUserId = 5, IsActive = true,
        Recipients = recipients.Length > 0 ? [.. recipients] : [To("Email", "ops@tasnim.om")],
    };

    private static ScheduleRecipient To(string type, string value) => new() { Kind = "To", RecipientType = type, Value = value };
    private static ScheduleRecipient Cc(string type, string value) => new() { Kind = "Cc", RecipientType = type, Value = value };
    private static ScheduleRecipient Bcc(string type, string value) => new() { Kind = "Bcc", RecipientType = type, Value = value };

    [Fact]
    public async Task A_renderer_note_such_as_filters_a_saved_view_did_not_apply_is_logged_on_the_run()
    {
        _renderer.Setup(r => r.RenderAsync(It.IsAny<Schedule>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RenderedDelivery("Wells", "http://app/x", false, [], "\"Delivery\" is not filtered by: plant."));

        var run = await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Sent");
        run.Error.Should().Be("\"Delivery\" is not filtered by: plant.");
    }

    [Fact]
    public async Task A_run_renders_as_the_owner_sends_and_logs()
    {
        var schedule = Schedule();
        var run = await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Sent");
        run.RecipientCount.Should().Be(1);
        run.AttachmentBytes.Should().Be(10);
        run.Attempt.Should().Be(1);
        run.TargetName.Should().Be("Wells");
        _renderedAs.Should().Be(Owner);
        RunAsScope.User.Should().BeNull();
        _sent.Single().Subject.Should().Be("Wells on 28 Sep 2026");
        _sent.Single().Body.Should().Contain("http://app/reports/view/9");
        _runs.Should().ContainSingle();
        schedule.LastStatus.Should().Be("Sent");
        schedule.LastRunAt.Should().Be(Now);
        schedule.NextRunAt.Should().Be(new DateTime(2026, 9, 29, 3, 0, 0, DateTimeKind.Utc));
        _store.Verify(s => s.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task An_empty_result_is_skipped_when_asked()
    {
        _renderer.Setup(r => r.RenderAsync(It.IsAny<Schedule>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new RenderedDelivery("Wells", "http://app/x", true, []));
        var schedule = Schedule();
        schedule.SkipIfEmpty = true;

        var run = await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Skipped");
        _sent.Should().BeEmpty();
    }

    [Fact]
    public async Task A_failing_send_is_tried_three_times_then_fails()
    {
        _mail.Setup(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>())).ThrowsAsync(new IOException("server down"));

        var run = await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Failed");
        run.Attempt.Should().Be(3);
        run.Error.Should().Contain("server down");
        _waits.Should().Equal(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task A_send_that_works_on_the_second_try_is_sent()
    {
        _mail.SetupSequence(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("busy"))
            .ReturnsAsync(new MailResult([]));

        var run = await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Sent");
        run.Attempt.Should().Be(2);
    }

    [Fact]
    public async Task Recipients_are_expanded_and_deduplicated_with_To_winning()
    {
        var schedule = Schedule(
            To("Email", "team@tasnim.om"), To("User", "5"),
            Cc("Role", "viewer"), Cc("Email", "TEAM@tasnim.om"),
            Bcc("Group", "3"), Bcc("Email", "ana@tasnim.om"), Bcc("Email", "hidden@tasnim.om"));

        await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        var mail = _sent.Single();
        mail.To.Should().Equal("team@tasnim.om", "owner@tasnim.om");
        mail.Cc.Should().Equal("Ana@Tasnim.om");
        mail.Bcc.Should().Equal("hidden@tasnim.om");
    }

    [Fact]
    public async Task An_inactive_owner_fails_the_run_without_reading_data()
    {
        _directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([Owner with { IsActive = false }]);
        var schedule = Schedule();

        var run = await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Failed");
        run.Error.Should().Contain("owner");
        _renderer.Verify(r => r.RenderAsync(It.IsAny<Schedule>(), It.IsAny<CancellationToken>()), Times.Never);
        schedule.IsActive.Should().BeTrue();
        _runs.Should().ContainSingle();
    }

    [Fact]
    public async Task A_finished_run_once_schedule_is_deactivated()
    {
        var schedule = Schedule();
        schedule.Cron = null;
        schedule.RunOnceAt = Now;

        await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        schedule.IsActive.Should().BeFalse();
        schedule.NextRunAt.Should().BeNull();
    }

    [Fact]
    public async Task Run_now_keeps_the_next_run()
    {
        var schedule = Schedule();
        schedule.NextRunAt = new DateTime(2026, 10, 1, 3, 0, 0);

        var run = await Runner().RunAsync(schedule, DeliveryTerms.RunNow, Now, default);

        run.Trigger.Should().Be("RunNow");
        schedule.NextRunAt.Should().Be(new DateTime(2026, 10, 1, 3, 0, 0));
    }

    [Fact]
    public async Task A_test_goes_to_the_owner_only_and_saves_nothing()
    {
        var schedule = Schedule(To("Email", "ops@tasnim.om"), Cc("Role", "viewer"));

        var run = await Runner().RunAsync(schedule, DeliveryTerms.Test, Now, default);

        run.Status.Should().Be("Sent");
        run.ScheduleId.Should().BeNull();
        _sent.Single().To.Should().Equal("owner@tasnim.om");
        _sent.Single().Cc.Should().BeEmpty();
        _runs.Should().BeEmpty();
        _store.Verify(s => s.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Refused_addresses_are_listed_and_the_rest_still_count()
    {
        _mail.Setup(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MailResult(["x@gmail.com"]));
        var schedule = Schedule(To("Email", "ops@tasnim.om"), To("Email", "x@gmail.com"));

        var run = await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Sent");
        run.RecipientCount.Should().Be(1);
        run.Error.Should().Contain("x@gmail.com");
    }

    [Fact]
    public async Task An_owner_who_can_no_longer_view_the_item_fails_the_run()
    {
        _directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([Owner with { ViewModules = ["smart-alerts.schedules", "dashboard.canvas"] }]);

        var run = await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Failed");
        run.Error.Should().Contain("view this report");
        _renderer.Verify(r => r.RenderAsync(It.IsAny<Schedule>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task An_owner_who_lost_schedules_fails_the_run_unless_admin()
    {
        _directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([Owner with { ViewModules = ["reports.my-reports"] }]);
        (await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default)).Error.Should().Contain("schedules");

        _directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([Owner with { RoleCodes = ["tenant_admin"], ViewModules = [] }]);
        (await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default)).Status.Should().Be("Sent");
    }

    [Fact]
    public async Task A_note_from_the_sender_is_kept_on_a_sent_run()
    {
        _mail.Setup(m => m.SendAsync(It.IsAny<MailEnvelope>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MailResult([], "No mail server is set; the message was saved to the pickup folder."));

        var run = await Runner().RunAsync(Schedule(), DeliveryTerms.OnSchedule, Now, default);

        run.Status.Should().Be("Sent");
        run.Error.Should().Contain("pickup folder");
    }

    [Fact]
    public async Task The_schedule_is_read_again_before_the_run_is_recorded_and_a_paused_one_stays_paused()
    {
        var schedule = Schedule();
        _store.Setup(s => s.ReloadAsync(schedule, It.IsAny<CancellationToken>()))
            .Callback(() => { schedule.IsActive = false; schedule.NextRunAt = null; }).Returns(Task.CompletedTask);

        await Runner().RunAsync(schedule, DeliveryTerms.OnSchedule, Now, default);

        _store.Verify(s => s.ReloadAsync(schedule, It.IsAny<CancellationToken>()), Times.Once);
        schedule.IsActive.Should().BeFalse();
        schedule.NextRunAt.Should().BeNull();
        schedule.LastStatus.Should().Be("Sent");
    }
}
