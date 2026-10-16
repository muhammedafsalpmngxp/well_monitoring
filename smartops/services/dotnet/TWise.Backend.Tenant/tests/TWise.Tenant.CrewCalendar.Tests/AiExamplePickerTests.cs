using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class ExamplePickerTests
{
    private static AiExample E(long id, string q, string status) => new() { Id = id, Question = q, Status = status };

    [Fact]
    public void Only_liked_and_approved_examples_are_used()
    {
        var all = new[]
        {
            E(1, "wells by cluster", AiExampleStatus.Liked), E(2, "wells by cluster name", AiExampleStatus.Approved),
            E(3, "wells by cluster", AiExampleStatus.Rejected), E(4, "wells by cluster", AiExampleStatus.Disliked),
            E(5, "wells by cluster", AiExampleStatus.Pending),
        };
        Assert.Equal([1L, 2L], ExamplePicker.Pick(all, "how many wells by cluster", 4).Select(e => e.Id).OrderBy(x => x));
    }

    [Fact]
    public void A_users_like_beats_the_models_approval_on_a_tie()
    {
        var all = new[] { E(9, "wells by plant", AiExampleStatus.Approved), E(3, "wells by plant", AiExampleStatus.Liked) };
        Assert.Equal(3, ExamplePicker.Pick(all, "wells by plant", 1)[0].Id);
    }
}
