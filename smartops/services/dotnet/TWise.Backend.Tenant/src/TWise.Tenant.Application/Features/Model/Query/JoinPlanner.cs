namespace TWise.Tenant.Application.Features.Model.Query;

public sealed record JoinStep(ModelSource Joined, ModelRelationship Via);

/// <summary>
/// Finds the joins that connect the sources a query touches. The first needed source is the
/// root. Every other needed source must be reachable by exactly one path: none is
/// missing_relationship, more than one is ambiguous_path. Guessing a path is how a BI tool
/// produces a confidently wrong number.
/// </summary>
public static class JoinPlanner
{
    public static IReadOnlyList<JoinStep> Plan(
        IReadOnlyList<ModelSource> needed, IReadOnlyList<ModelSource> all, IReadOnlyList<ModelRelationship> relationships)
    {
        var root = needed[0];
        var edges = new HashSet<ModelRelationship>();

        foreach (var target in needed.Skip(1))
        {
            var path = ShortestPath(root.Id, target.Id, relationships, excluded: null)
                ?? throw new QueryException(QueryErrors.MissingRelationship,
                    $"{root.Alias} and {target.Alias} are not related. Add a relationship?");

            // A second path exists exactly when some edge of this one can be removed and the
            // target is still reachable: if every edge on it were a bridge, it would be the only path.
            if (path.Any(edge => ShortestPath(root.Id, target.Id, relationships, excluded: edge) is not null))
                throw new QueryException(QueryErrors.AmbiguousPath,
                    $"{root.Alias} and {target.Alias} are connected in more than one way. Choose which relationship to use.");

            edges.UnionWith(path);
        }

        // Breadth-first from the root, so every ON clause refers only to sources already joined.
        var byId = all.ToDictionary(s => s.Id);
        var inScope = new HashSet<long> { root.Id };
        var steps = new List<JoinStep>();
        var queue = new Queue<long>([root.Id]);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var edge in edges)
            {
                var other = Other(edge, current);
                if (other is null || !inScope.Add(other.Value)) continue;
                steps.Add(new JoinStep(byId[other.Value], edge));
                queue.Enqueue(other.Value);
            }
        }
        return steps;
    }

    /// <summary>Breadth-first search; the relationships on one shortest path, or null if none.</summary>
    private static List<ModelRelationship>? ShortestPath(
        long from, long target, IReadOnlyList<ModelRelationship> relationships, ModelRelationship? excluded)
    {
        var via = new Dictionary<long, ModelRelationship?> { [from] = null };
        var queue = new Queue<long>([from]);
        while (queue.Count > 0 && !via.ContainsKey(target))
        {
            var at = queue.Dequeue();
            foreach (var edge in relationships)
            {
                if (edge == excluded) continue;
                var next = Other(edge, at);
                if (next is null || !via.TryAdd(next.Value, edge)) continue;
                queue.Enqueue(next.Value);
            }
        }
        if (!via.ContainsKey(target)) return null;

        var path = new List<ModelRelationship>();
        for (var at = target; via[at] is { } edge; at = Other(edge, at)!.Value)
            path.Add(edge);
        return path;
    }

    private static long? Other(ModelRelationship edge, long sourceId)
        => edge.FromSourceId == sourceId ? edge.ToSourceId
         : edge.ToSourceId == sourceId ? edge.FromSourceId
         : null;
}
