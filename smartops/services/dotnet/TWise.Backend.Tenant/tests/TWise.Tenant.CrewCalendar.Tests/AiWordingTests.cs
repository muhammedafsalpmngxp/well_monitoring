using TWise.Tenant.Application.Features.Ai;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class WordingTests
{
    [Theory]
    [InlineData("this dataset does not have a column for downtime hours", "This dataset does not have a column for downtime hours.")]
    [InlineData("Which cluster did you mean?", "Which cluster did you mean?")]
    public void Sentences_start_with_a_capital_and_end_with_a_stop(string input, string expected) =>
        Assert.Equal(expected, Wording.Sentence(input));

    [Fact]
    public void A_clarify_question_ends_with_a_question_mark() =>
        Assert.Equal("Marmul as a cluster or as a plant?", Wording.Sentence("marmul as a cluster or as a plant", '?'));

    [Theory]
    [InlineData("plant_description", "plant description")]
    [InlineData("plan_due", "plan due")]
    [InlineData("wellId", "well Id")]
    [InlineData("Well ID", "Well ID")]
    public void Database_names_become_words(string name, string expected) =>
        Assert.Equal(expected, Wording.Words(name));

    [Fact]
    public void Stored_times_are_sent_as_utc()
    {
        var read = new DateTime(2026, 10, 3, 9, 26, 0, DateTimeKind.Unspecified);
        Assert.Equal(DateTimeKind.Utc, AiDates.Utc(read).Kind);
        Assert.Equal("2026-10-03T09:26:00Z", System.Text.Json.JsonSerializer.Serialize(AiDates.Utc(read)).Trim('"'));
        Assert.Null(AiDates.Utc((DateTime?)null));
    }
}
