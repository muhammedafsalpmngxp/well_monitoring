using FluentAssertions;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Domain.DTOs;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Agents;

public sealed class AgentUsageTests
{
    [Fact]
    public void Purpose_NamesTheAgentAndRun_AndFitsTheColumn()
    {
        AgentUsage.Purpose(12, 345).Should().Be("agent:12:345");
        AgentUsage.Purpose(null, 345).Should().Be("agent:0:345");
        AgentUsage.Purpose(9_999_999_999_999_999, 9_999_999_999_999_999).Length.Should().BeLessThanOrEqualTo(40);   // core.AiUsageLog.purpose
        AgentUsage.Purpose(long.MaxValue, long.MaxValue).Should().Be("agent");   // too long: untagged, never a failed insert
    }

    [Theory]
    [InlineData("agent:12:345", true, 12, 345)]
    [InlineData("agent", false, 0, 0)]          // logged before usage was tied to agents
    [InlineData("agent:12", false, 0, 0)]
    [InlineData("agent:x:1", false, 0, 0)]
    [InlineData("ask", false, 0, 0)]
    public void TryParse_ReadsOnlyTaggedRows(string purpose, bool ok, long agent, long run)
    {
        AgentUsage.TryParse(purpose, out var a, out var r).Should().Be(ok);
        if (ok) { a.Should().Be(agent); r.Should().Be(run); }
    }

    [Fact]
    public void ByAgent_AddsUpRuns_AndListsModelsMostUsedFirst()
    {
        var rows = new[]
        {
            new AgentUsageRow("agent:12:1", "gpt-4o-mini", 1, 100, 10),
            new AgentUsageRow("agent:12:1", "gpt-5.6-luna", 3, 900, 90),
            new AgentUsageRow("agent:12:2", "gpt-5.6-luna", 2, 600, 60),
            new AgentUsageRow("agent:7:3", "gpt-5.6-luna", 1, 50, 5),
            new AgentUsageRow("agent:0:4", "gpt-5.6-luna", 9, 9, 9),    // tested before it was saved: no agent
        };

        var byAgent = AgentUsage.ByAgent(rows);

        byAgent.Keys.Should().BeEquivalentTo([12L, 7L]);
        var a = byAgent[12];
        a.Calls.Should().Be(6);
        a.PromptTokens.Should().Be(1600);
        a.CompletionTokens.Should().Be(160);
        a.TotalTokens.Should().Be(1760);
        a.Models.Select(m => m.Model).Should().Equal("gpt-5.6-luna", "gpt-4o-mini");
        a.Models[0].Calls.Should().Be(5);
    }

    [Fact]
    public void ByRun_KeepsEveryRun_IncludingUnsavedAgents()
    {
        var byRun = AgentUsage.ByRun([new AgentUsageRow("agent:12:1", "m", 2, 10, 1), new AgentUsageRow("agent:0:4", "m", 1, 5, 1)]);
        byRun[1].Calls.Should().Be(2);
        byRun[4].PromptTokens.Should().Be(5);
    }

    [Fact]
    public void Summarise_IsNullWithoutRows() => AgentUsage.Summarise([]).Should().BeNull();
}
