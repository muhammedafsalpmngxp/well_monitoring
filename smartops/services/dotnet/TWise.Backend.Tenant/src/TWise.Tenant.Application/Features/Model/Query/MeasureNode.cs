using System.Text.Json;
using System.Text.Json.Serialization;

namespace TWise.Tenant.Application.Features.Model.Query;

/// <summary>
/// Expression tree for a measure (model.Measure.ExpressionAst) or a calculated column
/// (model.CalculatedColumn.ExpressionAst). The tree is the source of truth; the text and visual editors
/// both read and write it. A measure aggregates (agg); a calculated column works on one row (text, fn).
/// On .NET 8 the "kind" discriminator must be the first property of each JSON object.
/// </summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(AggregateNode), "agg")]
[JsonDerivedType(typeof(ColumnNode), "col")]
[JsonDerivedType(typeof(NumberNode), "num")]
[JsonDerivedType(typeof(BinaryNode), "bin")]
[JsonDerivedType(typeof(TextNode), "text")]
[JsonDerivedType(typeof(FunctionNode), "fn")]
[JsonDerivedType(typeof(CompareNode), "cmp")]
[JsonDerivedType(typeof(MeasureRefNode), "ref")]
public abstract record MeasureNode
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}

/// <summary>
/// fn is sum, avg, count, count_distinct, min, max or count_rows. count_rows (COUNTROWS) counts the rows of
/// Arg.Source and reads no column; its Arg.Column is "*". Where, when set, limits the rows the aggregate
/// reads to those that pass the condition. It is not written to JSON when null, so a measure without
/// a condition is stored exactly as before.
/// </summary>
public sealed record AggregateNode(
    string Fn,
    ColumnNode Arg,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] MeasureCondition? Where = null) : MeasureNode;

/// <summary>
/// One comparison on a column of the aggregate's own source. op is eq, neq, gt, gte, lt or lte.
/// Value is always text; the compiler converts it for number and date columns and always passes it
/// as a parameter.
/// </summary>
public sealed record MeasureCondition(ColumnNode Column, string Op, string Value);

/// <summary>A column of a dataset source, addressed by the source alias.</summary>
public sealed record ColumnNode(string Source, string Column) : MeasureNode;

public sealed record NumberNode(decimal Value) : MeasureNode;

/// <summary>op is +, -, * or /.</summary>
public sealed record BinaryNode(string Op, MeasureNode Left, MeasureNode Right) : MeasureNode;

/// <summary>A text value in a calculated column's formula. It always reaches SQL Server as a parameter.</summary>
public sealed record TextNode(string Value) : MeasureNode;

/// <summary>
/// A function. In a calculated column, fn is one of the row functions QueryCompiler.RenderRow reads (concat,
/// if, datediff and the others). In a measure, fn is percent_of_total, running_total, change, change_pct, rank or ytd
/// around one calculation, moving_avg around a calculation and a number of rows, or threshold around a calculation,
/// an amber number and a green number; a measure refuses the row functions and aggregates a calculated column instead.
/// </summary>
public sealed record FunctionNode(string Fn, IReadOnlyList<MeasureNode> Args) : MeasureNode
{
    // A record compares a list by reference; two trees read from the same JSON must be equal.
    public bool Equals(FunctionNode? other)
        => other is not null && Fn == other.Fn && (Args ?? []).SequenceEqual(other.Args ?? []);

    public override int GetHashCode() => HashCode.Combine(Fn, Args?.Count);
}

/// <summary>
/// A comparison of two values of one row, in a calculated column: op is eq, neq, gt, gte, lt or lte. IF, AND,
/// OR and NOT read it as a condition; as a value it is 1 when it holds and 0 when it does not.
/// </summary>
public sealed record CompareNode(string Op, MeasureNode Left, MeasureNode Right) : MeasureNode;

/// <summary>
/// Another measure of the same dataset, by name, written [Measure name]. It is never compiled as it is:
/// DatasetRules.ExpandRefs puts the named measure's own formula in its place first.
/// </summary>
public sealed record MeasureRefNode(string Measure) : MeasureNode;
