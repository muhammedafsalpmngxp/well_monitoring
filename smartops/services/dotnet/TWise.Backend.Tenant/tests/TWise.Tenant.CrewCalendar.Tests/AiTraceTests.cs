using System.Text.Json;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class TraceTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void A_stored_trace_reads_back_with_prompts_and_replies()
    {
        List<AiTraceStep> trace =
        [
            new("load", 120, "5 columns, 1000 rows loaded"),
            new("ask", 2300, "Question to query", [new AiMessage("system", "Return JSON"), new AiMessage("user", "how many wells?")], """{"measures":[{"agg":"count"}]}"""),
            new("query", 40, "Run in memory: 1 result rows"),
        ];
        var back = JsonSerializer.Deserialize<List<AiTraceStep>>(JsonSerializer.Serialize(trace, Json), Json)!;
        Assert.Equal(["load", "ask", "query"], back.Select(s => s.Step));
        Assert.Equal("how many wells?", back[1].Prompt![1].Content);
        Assert.Equal("""{"measures":[{"agg":"count"}]}""", back[1].Reply);
        Assert.Null(back[2].Prompt);
    }

    [Fact]
    public void Trace_is_a_feature_an_admin_grants() =>
        Assert.Contains(AiFeatureCatalog.All, f => f.Key == AiFeatureCatalog.Trace);
}
