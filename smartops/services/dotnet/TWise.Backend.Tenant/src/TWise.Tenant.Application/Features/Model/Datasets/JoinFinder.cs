using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>
/// What the data says about a join of column a of one table to column b of another: rows and distinct values on
/// each side, and, of a sample of each side's distinct values, how many the other side also holds.
/// </summary>
public sealed record JoinProbe(long ARows, long ADistinct, long BRows, long BDistinct, int ASampled, int AFoundInB, int BSampled, int BFoundInA);

/// <summary>
/// A pair of table columns worth probing: the same key-like name in two tables of the dataset. ADatabase and BDatabase
/// name the database of a table that is not in the model's own (ModelSnapshot.DatabaseOf).
/// </summary>
public sealed record JoinCandidate(DatasetSource A, string AColumn, DatasetSource B, string BColumn, string? ADatabase = null, string? BDatabase = null);

/// <summary>
/// Relationships suggested from the data rather than from declared foreign keys. Two tables that share a key-like
/// column name are probed; when one side holds each value once and most of the other side's values are found there,
/// the join is suggested from the many side to the one side.
/// </summary>
public static class JoinFinder
{
    /// <summary>At most this many candidates are probed for one dataset.</summary>
    public const int MaxCandidates = 15;

    /// <summary>Of the many side's sampled values, at least this share must be found on the one side.</summary>
    public const int MinMatchPercent = 60;

    private static readonly string[] KeyEndings = ["_id", "_key", "_code", "id", "key", "code"];

    // Columns that end like keys in most tables but never join them.
    private static readonly HashSet<string> NotKeys = new(StringComparer.OrdinalIgnoreCase)
        { "source_system_id", "source_id", "tenant_id", "created_by", "modified_by", "row_id" };

    /// <summary>
    /// Pairs of tables of the dataset that share a key-like column of the same kind of value and are not yet
    /// joined to each other in any way, nor suggested already.
    /// </summary>
    public static IReadOnlyList<JoinCandidate> Candidates(
        IReadOnlyList<DatasetSource> sources, IReadOnlyList<CatalogColumn> columns,
        IReadOnlyList<DatasetRelationship> existing, IReadOnlyList<RelationshipSuggestionDto> known)
    {
        var tables = sources.Where(s => s.SourceKind == "table").OrderBy(s => s.Id).ToList();
        var candidates = new List<JoinCandidate>();
        for (var i = 0; i < tables.Count; i++)
        for (var j = i + 1; j < tables.Count; j++)
        {
            var (a, b) = (tables[i], tables[j]);
            if (existing.Any(r => Links(r.FromSourceId, r.ToSourceId, a.Id, b.Id))
                || known.Any(k => Links(k.FromSourceId, k.ToSourceId, a.Id, b.Id)))
                continue;
            var bColumns = ColumnsOf(columns, b).ToDictionary(c => c.Column, StringComparer.OrdinalIgnoreCase);
            foreach (var ac in ColumnsOf(columns, a).Where(c => IsKeyLike(c.Column)))
            {
                if (bColumns.TryGetValue(ac.Column, out var bc) && Family(ac.DataType) is { } family && family == Family(bc.DataType))
                    candidates.Add(new JoinCandidate(a, ac.Column, b, bc.Column));
            }
        }
        return candidates.Take(MaxCandidates).ToList();
    }

    /// <summary>
    /// The suggestion the probe supports, or null. The side whose column holds each value once is the one side; when
    /// both do, the join is one to one. Nothing is suggested when neither side is unique or too few values match.
    /// </summary>
    public static RelationshipSuggestionDto? Suggest(JoinCandidate candidate, JoinProbe probe)
    {
        var aUnique = probe.ARows > 0 && probe.ARows == probe.ADistinct;
        var bUnique = probe.BRows > 0 && probe.BRows == probe.BDistinct;
        if (!aUnique && !bUnique) return null;

        // Many side a to one side b, unless only a is unique.
        var manyIsA = bUnique;
        var (sampled, found) = manyIsA ? (probe.ASampled, probe.AFoundInB) : (probe.BSampled, probe.BFoundInA);
        if (sampled == 0) return null;
        var percent = found * 100 / sampled;
        if (percent < MinMatchPercent) return null;

        var cardinality = aUnique && bUnique ? "one_to_one" : "many_to_one";
        return manyIsA
            ? new RelationshipSuggestionDto(candidate.A.Id, candidate.AColumn, candidate.B.Id, candidate.BColumn, cardinality, "data", percent)
            : new RelationshipSuggestionDto(candidate.B.Id, candidate.BColumn, candidate.A.Id, candidate.AColumn, cardinality, "data", percent);
    }

    /// <summary>
    /// The one query that counts what JoinProbe holds, run on the model's connection. The names come from the dataset's
    /// sources and the catalogue, and are quoted as identifiers.
    /// </summary>
    public static string ProbeSql(JoinCandidate candidate)
    {
        var a = QueryCompiler.TableName(candidate.ADatabase, candidate.A.SchemaName, candidate.A.SourceName);
        var b = QueryCompiler.TableName(candidate.BDatabase, candidate.B.SchemaName, candidate.B.SourceName);
        var ac = Q(candidate.AColumn);
        var bc = Q(candidate.BColumn);
        string Sample(string table, string column) => $"SELECT DISTINCT TOP (500) {column} AS v FROM {table} WHERE {column} IS NOT NULL";
        return "SELECT " + string.Join(", ",
            $"(SELECT COUNT_BIG({ac}) FROM {a})", $"(SELECT COUNT_BIG(DISTINCT {ac}) FROM {a})",
            $"(SELECT COUNT_BIG({bc}) FROM {b})", $"(SELECT COUNT_BIG(DISTINCT {bc}) FROM {b})",
            $"(SELECT COUNT(*) FROM ({Sample(a, ac)}) s)",
            $"(SELECT COUNT(*) FROM ({Sample(a, ac)}) s WHERE EXISTS (SELECT 1 FROM {b} x WHERE x.{bc} = s.v))",
            $"(SELECT COUNT(*) FROM ({Sample(b, bc)}) s)",
            $"(SELECT COUNT(*) FROM ({Sample(b, bc)}) s WHERE EXISTS (SELECT 1 FROM {a} x WHERE x.{ac} = s.v))");

        static string Q(string name) => "[" + name.Replace("]", "]]") + "]";
    }

    private static bool IsKeyLike(string column)
        => !NotKeys.Contains(column) && KeyEndings.Any(ending => column.EndsWith(ending, StringComparison.OrdinalIgnoreCase));

    private static bool Links(long from, long to, long a, long b) => (from == a && to == b) || (from == b && to == a);

    private static IEnumerable<CatalogColumn> ColumnsOf(IReadOnlyList<CatalogColumn> columns, DatasetSource source)
        => columns.Where(c => string.Equals(c.Schema, source.SchemaName, StringComparison.OrdinalIgnoreCase)
                              && string.Equals(c.Table, source.SourceName, StringComparison.OrdinalIgnoreCase));

    /// <summary>Numbers join numbers and text joins text; other types are not probed.</summary>
    private static string? Family(string? dataType)
    {
        var type = (dataType ?? string.Empty).Split('(')[0].Trim().ToLowerInvariant();
        return type switch
        {
            "int" or "bigint" or "smallint" or "tinyint" or "decimal" or "numeric" => "number",
            "char" or "varchar" or "nchar" or "nvarchar" => "text",
            _ => null,
        };
    }
}
