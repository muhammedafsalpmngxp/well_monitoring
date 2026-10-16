using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class BusinessTermsTests
{
    private static readonly AiTerm Producing = new() { Term = "producing wells", Synonyms = "producers, on stream", ColumnName = "Status", Value = "P" };
    private static readonly AiTerm Backlog = new() { Term = "backlog", Meaning = "jobs with progress below 100" };

    [Fact]
    public void Terms_are_found_by_name_or_synonym_as_whole_words()
    {
        Assert.Equal([Producing], BusinessTerms.Used([Producing, Backlog], "How many PRODUCERS in Nimr?"));
        Assert.Empty(BusinessTerms.Used([Backlog], "show backlogged items")); // part of a word does not count
    }

    [Fact]
    public void Prompt_lists_every_term_and_marks_the_used_ones()
    {
        var text = BusinessTerms.Describe([Producing, Backlog], [Producing]);
        Assert.Contains("- \"producing wells\" (also: producers, on stream): filter Status = 'P'   <- used in this question", text);
        Assert.Contains("- \"backlog\": jobs with progress below 100\n", text);
    }

    [Fact]
    public void Used_terms_are_removed_before_value_matching() =>
        Assert.Equal("count   in Marmul", BusinessTerms.Strip([Producing], "count on stream in Marmul"));
}
