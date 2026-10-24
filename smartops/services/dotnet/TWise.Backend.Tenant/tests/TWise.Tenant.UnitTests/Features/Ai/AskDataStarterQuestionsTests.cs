using TWise.Tenant.Application.Features.Ai;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>
/// Ask your data → the suggested first questions an admin keeps under AI Prompts → Ask Data → Suggested first
/// questions: one per line; an empty list lets Ask Data suggest questions from the data.
/// </summary>
public class AskDataStarterQuestionsTests
{
    [Fact]
    public void One_question_per_line_with_blanks_comments_and_repeats_dropped()
    {
        AiPrompts.StarterQuestions("How many wells per cluster?\r\n\n  # an admin's note\n  Which wells are due next month?  \nhow many wells per cluster?")
            .Should().Equal("How many wells per cluster?", "Which wells are due next month?");
    }

    [Fact]
    public void An_empty_list_means_the_automatic_suggestions()
    {
        AiPrompts.StarterQuestions(null).Should().BeEmpty();
        AiPrompts.StarterQuestions("  \n # only a note\n").Should().BeEmpty();
    }

    [Fact]
    public void At_most_six_questions_and_none_longer_than_the_limit()
    {
        var text = string.Join('\n', Enumerable.Range(1, 9).Select(i => $"Question {i}?")) + "\n" + new string('x', AiPrompts.MaxStarterLength + 1);
        AiPrompts.StarterQuestions(text).Should().HaveCount(AiPrompts.MaxStarters).And.OnlyContain(q => q.Length <= AiPrompts.MaxStarterLength);
    }

    [Fact]
    public void The_prompt_is_listed_under_Ask_Data_may_be_emptied_and_is_seeded_with_questions()
    {
        var def = AiPromptCatalog.All.Single(d => d.Key == AiPrompts.AskDataStarters);
        def.Group.Should().Be(AiPromptCatalog.AskData);
        def.AllowEmpty.Should().BeTrue();
        def.Name.Should().Be("Suggested first questions");
    }
}
