using System.Text.Json;
using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class MeasureNodeTests
{
    [Fact]
    public void Stored_ast_json_reads_back_as_a_tree()
    {
        const string json = """
            {"kind":"bin","op":"/",
             "left":{"kind":"agg","fn":"sum","arg":{"source":"d","column":"OilBbl"}},
             "right":{"kind":"num","value":1000}}
            """;

        var node = JsonSerializer.Deserialize<MeasureNode>(json, MeasureNode.JsonOptions);

        node.Should().Be(new BinaryNode("/",
            new AggregateNode("sum", new ColumnNode("d", "OilBbl")),
            new NumberNode(1000)));
    }

    [Fact]
    public void Condition_reads_back_and_is_left_out_of_the_json_when_absent()
    {
        const string json = """{"kind":"agg","fn":"sum","arg":{"source":"d","column":"OilBbl"},"where":{"column":{"source":"d","column":"WellId"},"op":"eq","value":"7"}}""";

        var node = JsonSerializer.Deserialize<MeasureNode>(json, MeasureNode.JsonOptions);

        node.Should().Be(new AggregateNode("sum", new ColumnNode("d", "OilBbl"),
            new MeasureCondition(new ColumnNode("d", "WellId"), "eq", "7")));
        JsonSerializer.Serialize(node, MeasureNode.JsonOptions).Should().Be(json);
        JsonSerializer.Serialize<MeasureNode>(new AggregateNode("count", new ColumnNode("d", "WellId")), MeasureNode.JsonOptions)
            .Should().Be("""{"kind":"agg","fn":"count","arg":{"source":"d","column":"WellId"}}""");
    }

    [Fact]
    public void Row_formula_nodes_read_back_and_compare_by_their_parts()
    {
        const string json = """{"kind":"fn","fn":"concat","args":[{"kind":"col","source":"t","column":"code"},{"kind":"text","value":" - "},{"kind":"num","value":3}]}""";

        var node = JsonSerializer.Deserialize<MeasureNode>(json, MeasureNode.JsonOptions);

        node.Should().Be(new FunctionNode("concat", [new ColumnNode("t", "code"), new TextNode(" - "), new NumberNode(3)]));
        JsonSerializer.Serialize(node, MeasureNode.JsonOptions).Should().Be(json);
    }

    [Fact]
    public void Comparison_nodes_read_back_and_compare_by_their_parts()
    {
        const string json = """{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"gt","left":{"kind":"col","source":"t","column":"x"},"right":{"kind":"num","value":3}},{"kind":"text","value":"High"},{"kind":"text","value":"Low"}]}""";

        var node = JsonSerializer.Deserialize<MeasureNode>(json, MeasureNode.JsonOptions);

        node.Should().Be(new FunctionNode("if", [
            new CompareNode("gt", new ColumnNode("t", "x"), new NumberNode(3)), new TextNode("High"), new TextNode("Low"),
        ]));
        JsonSerializer.Serialize(node, MeasureNode.JsonOptions).Should().Be(json);
    }
}
