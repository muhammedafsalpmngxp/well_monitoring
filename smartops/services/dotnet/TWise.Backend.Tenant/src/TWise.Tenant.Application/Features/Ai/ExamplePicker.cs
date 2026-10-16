using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Chooses the stored examples that guide a new question on the same dataset.</summary>
public static class ExamplePicker
{
    /// <summary>
    /// Liked or approved examples ranked by words shared with the question; on a tie a person's
    /// thumbs-up beats the model's approval, then the newest wins. Cheap and good enough without embeddings.
    /// </summary>
    public static List<AiExample> Pick(IReadOnlyList<AiExample> all, string question, int max)
    {
        var words = Words(question);
        return all.Where(e => AiExampleStatus.Used.Contains(e.Status))
            .Select(e => (e, score: Words(e.Question).Intersect(words).Count()))
            .Where(x => x.score > 0)
            .OrderByDescending(x => x.score).ThenBy(x => x.e.Status == AiExampleStatus.Liked ? 0 : 1).ThenByDescending(x => x.e.Id)
            .Take(max).Select(x => x.e).ToList();
    }

    private static HashSet<string> Words(string text) =>
        text.ToLowerInvariant().Split([' ', ',', '.', '?', '!', ';', ':', '"', '\''], StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length > 2).ToHashSet();
}
