using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class ScheduleRulesTests
{
    private static readonly DateTime Now = new(2026, 9, 27, 10, 0, 0, DateTimeKind.Utc);

    private static ScheduleRequest Valid() => new(
        "Weekly wells", "Report", 7, "Xlsx", "0 7 * * MON", null, "Asia/Muscat", null, null, false,
        "{{item}} for {{run_date}}", "See attached.", [new RecipientDto("To", "Email", "ops@tasnim.om")]);

    private static string? Problem(ScheduleRequest request) => ScheduleRules.Problem(request, Now);

    [Fact]
    public void A_complete_request_has_no_problem() => Problem(Valid()).Should().BeNull();

    [Fact]
    public void Name_is_required() => Problem(Valid() with { Name = "  " }).Should().Contain("name");

    [Fact]
    public void Name_has_at_most_120_characters() => Problem(Valid() with { Name = new string('a', 121) }).Should().Contain("120");

    [Fact]
    public void Target_type_must_be_known() => Problem(Valid() with { TargetType = "Widget" }).Should().Contain("Report, Dashboard or Canvas");

    [Fact]
    public void Target_must_be_chosen() => Problem(Valid() with { TargetId = 0 }).Should().Contain("Choose");

    [Theory]
    [InlineData("Report", "Link", true)]
    [InlineData("Report", "Csv", true)]
    [InlineData("Canvas", "Xlsx", true)]
    [InlineData("Canvas", "Csv", false)]
    [InlineData("Dashboard", "Link", true)]
    [InlineData("Dashboard", "Xlsx", false)]
    [InlineData("Report", "Pdf", false)]
    public void Format_must_suit_the_target(string type, string format, bool ok)
        => (Problem(Valid() with { TargetType = type, Format = format }) is null).Should().Be(ok);

    [Fact]
    public void Invalid_cron_is_refused() => Problem(Valid() with { Cron = "every day" }).Should().Contain("cron");

    [Fact]
    public void Unknown_zone_is_refused() => Problem(Valid() with { TimeZone = "Nowhere/City" }).Should().Contain("time zone");

    [Fact]
    public void Run_once_needs_a_time() => Problem(Valid() with { Cron = null }).Should().NotBeNull();

    [Fact]
    public void Run_once_must_be_in_the_future()
    {
        Problem(Valid() with { Cron = null, RunOnceAt = Now.AddMinutes(-1) }).Should().Contain("future");
        Problem(Valid() with { Cron = null, RunOnceAt = Now.AddHours(1) }).Should().BeNull();
    }

    [Fact]
    public void End_must_be_after_start()
        => Problem(Valid() with { StartAt = Now.AddDays(2), EndAt = Now.AddDays(1) }).Should().Contain("end");

    [Fact]
    public void A_schedule_that_ended_before_now_is_refused()
        => Problem(Valid() with { StartAt = Now.AddDays(-9), EndAt = Now.AddDays(-2) }).Should().Contain("no run left");

    [Fact]
    public void Start_and_end_days_as_the_dialog_sends_them_are_accepted()
        => Problem(Valid() with { Cron = "0 7 * * 1-5", StartAt = new DateTime(2026, 9, 27, 20, 0, 0, DateTimeKind.Utc), EndAt = new DateTime(2026, 12, 31, 19, 59, 0, DateTimeKind.Utc) })
            .Should().BeNull();

    [Fact]
    public void Subject_is_required_and_one_line()
    {
        Problem(Valid() with { Subject = "" }).Should().Contain("subject");
        Problem(Valid() with { Subject = "Hello\r\nBcc: x@y.z" }).Should().Contain("one line");
        Problem(Valid() with { Subject = new string('s', 201) }).Should().Contain("200");
    }

    [Fact]
    public void Body_has_at_most_8000_characters() => Problem(Valid() with { Body = new string('b', 8001) }).Should().Contain("8000");

    [Fact]
    public void At_least_one_To_recipient()
        => Problem(Valid() with { Recipients = [new RecipientDto("Cc", "Email", "a@b.om")] }).Should().Contain("To");

    [Fact]
    public void At_most_100_recipients()
        => Problem(Valid() with { Recipients = Enumerable.Range(0, 101).Select(i => new RecipientDto("To", "Email", $"u{i}@b.om")).ToList() })
            .Should().Contain("100");

    [Theory]
    [InlineData("Email", "not an address")]
    [InlineData("User", "abc")]
    [InlineData("Group", "0")]
    [InlineData("Role", " ")]
    public void Each_recipient_must_be_valid(string type, string value)
        => Problem(Valid() with { Recipients = [new RecipientDto("To", type, value)] }).Should().NotBeNull();

    [Fact]
    public void Recipient_kind_must_be_known()
        => Problem(Valid() with { Recipients = [new RecipientDto("From", "Email", "a@b.om")] }).Should().Contain("To, Cc or Bcc");

    [Fact]
    public void A_mail_group_needs_a_name_and_valid_addresses_which_are_kept_once()
    {
        ScheduleRules.MailGroupProblem(new MailGroupRequest("Ops", null, [" a@t.om", "A@t.om", "b@t.om"]), out var members).Should().BeNull();
        members.Should().Equal("a@t.om", "b@t.om");

        ScheduleRules.MailGroupProblem(new MailGroupRequest(" ", null, ["a@t.om"]), out _).Should().Contain("name");
        ScheduleRules.MailGroupProblem(new MailGroupRequest("Ops", new string('d', 401), ["a@t.om"]), out _).Should().Contain("400");
        ScheduleRules.MailGroupProblem(new MailGroupRequest("Ops", null, []), out _).Should().Contain("address");
        ScheduleRules.MailGroupProblem(new MailGroupRequest("Ops", null, ["nope"]), out _).Should().Contain("nope");
    }

    [Fact]
    public void Cron_has_at_most_100_characters()
        => Problem(Valid() with { Cron = "0 7 * * " + string.Join(",", Enumerable.Repeat("1", 50)) }).Should().Contain("100");
}
