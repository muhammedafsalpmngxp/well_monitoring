using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class RecurrenceTests
{
    private static DateTime Utc(int y, int mo, int d, int h = 0, int mi = 0) => new(y, mo, d, h, mi, 0, DateTimeKind.Utc);

    private static RecurrenceSpec Cron(string cron, string zone = "UTC", DateTime? start = null, DateTime? end = null)
        => new(cron, null, zone, start, end);

    [Fact]
    public void Daily_at_seven_in_Muscat_is_three_UTC()
        => Recurrence.Next(Cron("0 7 * * *", "Asia/Muscat"), Utc(2026, 9, 27, 12)).Should().Be(Utc(2026, 9, 28, 3));

    [Fact]
    public void Weekly_on_Monday_and_Wednesday()
        => Recurrence.NextFive(Cron("0 7 * * MON,WED"), Utc(2026, 9, 27)).Should().Equal(
            Utc(2026, 9, 28, 7), Utc(2026, 9, 30, 7), Utc(2026, 10, 5, 7), Utc(2026, 10, 7, 7), Utc(2026, 10, 12, 7));

    [Fact]
    public void Monthly_on_the_last_day()
        => Recurrence.NextFive(Cron("0 7 L * *"), Utc(2026, 1, 1)).Take(3).Should().Equal(
            Utc(2026, 1, 31, 7), Utc(2026, 2, 28, 7), Utc(2026, 3, 31, 7));

    [Fact]
    public void First_Monday_of_the_month()
        => Recurrence.NextFive(Cron("0 7 * * MON#1"), Utc(2026, 9, 27)).Take(2).Should().Equal(
            Utc(2026, 10, 5, 7), Utc(2026, 11, 2, 7));

    [Fact]
    public void London_keeps_local_time_across_the_March_change()
        => Recurrence.NextFive(Cron("0 7 * * *", "Europe/London"), Utc(2026, 3, 27, 12)).Take(3).Should().Equal(
            Utc(2026, 3, 28, 7), Utc(2026, 3, 29, 6), Utc(2026, 3, 30, 6));

    [Fact]
    public void Run_once_is_the_run_time_only_while_it_is_ahead()
    {
        var once = new RecurrenceSpec(null, Utc(2026, 10, 1, 5), "UTC", null, null);
        Recurrence.Next(once, Utc(2026, 9, 30)).Should().Be(Utc(2026, 10, 1, 5));
        Recurrence.Next(once, Utc(2026, 10, 1, 5)).Should().BeNull();
        Recurrence.NextFive(once, Utc(2026, 9, 30)).Should().Equal(Utc(2026, 10, 1, 5));
    }

    [Fact]
    public void Start_delays_the_first_run_and_end_stops_them()
    {
        var spec = Cron("0 7 * * *", start: Utc(2026, 10, 1, 7), end: Utc(2026, 10, 3, 8));
        Recurrence.NextFive(spec, Utc(2026, 9, 1)).Should().Equal(Utc(2026, 10, 1, 7), Utc(2026, 10, 2, 7), Utc(2026, 10, 3, 7));
        Recurrence.Next(spec, Utc(2026, 10, 3, 7)).Should().BeNull();
    }

    [Theory]
    [InlineData("0 7 * *", "UTC", "cron")]
    [InlineData("61 7 * * *", "UTC", "cron")]
    [InlineData("0 7 * * *", "Mars/Olympus", "time zone")]
    [InlineData("0 7 * * *", "", "time zone")]
    public void Invalid_cron_and_unknown_zone_give_a_message(string cron, string zone, string mentions)
        => Recurrence.Problem(Cron(cron, zone)).Should().Contain(mentions);

    [Fact]
    public void A_valid_spec_has_no_problem()
        => Recurrence.Problem(Cron("*/15 * * * *", "Asia/Muscat")).Should().BeNull();

    [Fact]
    public void Neither_cron_nor_run_time_is_a_problem()
        => Recurrence.Problem(new RecurrenceSpec(null, null, "UTC", null, null)).Should().NotBeNull();

    [Theory]
    [InlineData("0 7 * * 1#1")]
    [InlineData("0 17 * * 5L")]
    [InlineData("0 7 L * *")]
    [InlineData("0 7 * * 1-5")]
    [InlineData("0 * * * *")]
    [InlineData("0 7 * * 1,3")]
    public void Every_cron_the_schedule_dialog_writes_is_accepted(string cron)
        => Recurrence.Problem(Cron(cron, "Asia/Muscat")).Should().BeNull();

    [Fact]
    public void Last_Friday_of_the_month()
        => Recurrence.NextFive(Cron("0 17 * * 5L"), Utc(2026, 9, 1)).Take(2).Should().Equal(Utc(2026, 9, 25, 17), Utc(2026, 10, 30, 17));

    [Fact]
    public void A_local_time_is_converted_to_UTC_and_an_unspecified_one_is_read_as_UTC()
    {
        var local = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Local);
        Recurrence.AsUtc(local).Should().Be(local.ToUniversalTime());
        Recurrence.AsUtc(new DateTime(2026, 1, 1, 12, 0, 0)).Should().Be(Utc(2026, 1, 1, 12));
    }
}
