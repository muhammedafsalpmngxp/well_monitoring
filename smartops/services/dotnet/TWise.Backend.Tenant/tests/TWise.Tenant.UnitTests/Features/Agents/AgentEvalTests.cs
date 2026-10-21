using System.Runtime.CompilerServices;
using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Agents;

public sealed class AgentEvalTests
{
    private readonly Mock<IAiAgentRepository> _repo = new();
    private readonly Mock<ISender> _sender = new();
    private readonly Mock<IAgentRuntimeClient> _runtime = new();
    private readonly Mock<IAiService> _ai = new();

    private RunAiAgentEvalHandler Sut => new(_repo.Object, _sender.Object, _runtime.Object, _ai.Object);

    private static AiAgent Saved() => new()
    {
        Id = 5, TenantId = 7, Name = "Well Count", Status = "published", StepsJson = "[{\"text\":\"Count wells in {{cluster}}\"}]",
        ToolsJson = "[{\"agent\":\"ask_data\",\"action\":\"deep\"}]", InputsJson = "[{\"name\":\"cluster\"}]",
    };

    private static async IAsyncEnumerable<AiAskEvent> Stream(string answer, long runId, [EnumeratorCancellation] CancellationToken ct = default)
    {
        await Task.Yield();
        yield return new AiAskEvent("done", new { runId, ok = true, answer });
    }

    private static async Task<List<AiAskEvent>> Collect(IAsyncEnumerable<AiAskEvent> events)
    {
        var list = new List<AiAskEvent>();
        await foreach (var e in events) list.Add(e);
        return list;
    }

    [Theory]
    [InlineData("Nimr has 393 wells.", "contains", "Nimr", true)]
    [InlineData("Nimr has 393 wells.", "number", "393", true)]
    [InlineData("Nimr has 1,393 wells.", "number", "1393", true)]
    [InlineData("Nimr has 392 wells.", "number", "393", false)]
    [InlineData("No data was found.", "not_contains", "no data", false)]
    public void Rules_CheckTheAnswer(string answer, string op, string value, bool passes) =>
        AgentEvals.Check(answer, [new AiAgentEvalRuleDto(op, value)]).Should().HaveCount(passes ? 0 : 1);

    [Fact]
    public async Task RunAll_ChecksRulesAndTheJudge_AndSavesTheScoreWithTheVersion()
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Saved());
        _repo.Setup(r => r.ListEvalCasesAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync([
            new AiAgentEvalCase { Id = 1, Name = "Nimr count", InputsJson = "{\"cluster\":\"Nimr\"}", RulesJson = "[{\"op\":\"number\",\"value\":\"393\"}]" },
            new AiAgentEvalCase { Id = 2, Name = "Lekhwair late", InputsJson = "{\"cluster\":\"Lekhwair\"}", Expectation = "Names the late wells", RulesJson = "[]" },
        ]);
        _repo.Setup(r => r.GetVersionAsync(7, 5, 0, It.IsAny<CancellationToken>())).ReturnsAsync(new AiAgentVersion { VersionNo = 4 });
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        _sender.SetupSequence(x => x.CreateStream(It.IsAny<IStreamRequest<AiAskEvent>>(), It.IsAny<CancellationToken>()))
            .Returns(Stream("Nimr has 393 wells.", 21)).Returns(Stream("Lekhwair: 2 wells behind plan.", 22));
        _runtime.Setup(r => r.JudgeAsync(It.IsAny<AgentRuntimeLlm>(), "cluster: Lekhwair", "Lekhwair: 2 wells behind plan.", "Names the late wells", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AgentJudgeResult(false, "It gives a count but no well names."));
        AiAgentEvalRun? saved = null;
        _repo.Setup(r => r.AddEvalRunAsync(It.IsAny<AiAgentEvalRun>(), It.IsAny<CancellationToken>()))
            .Callback<AiAgentEvalRun, CancellationToken>((r, _) => { r.Id = 9; saved = r; }).Returns(Task.CompletedTask);

        var events = await Collect(Sut.Handle(new RunAiAgentEvalStream(7, "1", "a@b.com", 5, new RunAiAgentEvalRequest(Draft: true)), default));

        events.Select(e => e.Type).Should().Equal("case", "case", "case", "case", "done");
        saved!.Passed.Should().Be(1);
        saved.Total.Should().Be(2);
        saved.VersionNo.Should().Be(4);
        saved.Draft.Should().BeTrue();
        var results = JsonSerializer.Deserialize<List<AiAgentEvalResultDto>>(saved.ResultsJson, AgentMapping.Json)!;
        results[0].Should().Match<AiAgentEvalResultDto>(r => r.Passed && r.RunId == 21);
        results[1].Reasons.Should().Equal("Judge: It gives a count but no well names.");
        _sender.Verify(x => x.CreateStream(It.Is<TestAiAgentStream>(t => t.UserName == "Eval · a@b.com" && t.Request.AgentId == 5), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task RunAll_ACaseFails_WhenTheJudgeCannotBeReached()
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Saved());
        _repo.Setup(r => r.ListEvalCasesAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync([
            new AiAgentEvalCase { Id = 2, Name = "Late", InputsJson = "{}", Expectation = "Names the late wells", RulesJson = "[]" }]);
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        _sender.Setup(x => x.CreateStream(It.IsAny<IStreamRequest<AiAskEvent>>(), It.IsAny<CancellationToken>())).Returns(Stream("W1 and W2", 3));
        _runtime.Setup(r => r.JudgeAsync(It.IsAny<AgentRuntimeLlm>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("502: judge down"));
        AiAgentEvalRun? saved = null;
        _repo.Setup(r => r.AddEvalRunAsync(It.IsAny<AiAgentEvalRun>(), It.IsAny<CancellationToken>()))
            .Callback<AiAgentEvalRun, CancellationToken>((r, _) => saved = r).Returns(Task.CompletedTask);

        await Collect(Sut.Handle(new RunAiAgentEvalStream(7, "1", "a@b.com", 5, new RunAiAgentEvalRequest()), default));

        saved!.Passed.Should().Be(0);
        saved.ResultsJson.Should().Contain("Not judged: 502: judge down");
    }

    [Fact]
    public async Task RunAll_RefusesWithoutCases_AndForAnotherTenantsAgent()
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Saved());
        _repo.Setup(r => r.ListEvalCasesAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync([]);
        (await Collect(Sut.Handle(new RunAiAgentEvalStream(7, "1", "a", 5, new RunAiAgentEvalRequest()), default)))
            .Should().ContainSingle().Which.Type.Should().Be("error");
        (await Collect(Sut.Handle(new RunAiAgentEvalStream(8, "1", "a", 5, new RunAiAgentEvalRequest()), default)))
            .Should().ContainSingle().Which.Type.Should().Be("error");
    }

    [Theory]
    [InlineData("Nimr count", "Says 393", null, true)]
    [InlineData("Nimr count", null, "number", true)]
    [InlineData("Nimr count", null, null, false)]
    [InlineData("", "Says 393", null, false)]
    [InlineData("Nimr count", null, "regex", false)]
    public void CaseValidator_NeedsANameAndAnExpectationOrRule(string name, string? expectation, string? op, bool valid) =>
        new SaveAiAgentEvalCaseRequestValidator().Validate(new SaveAiAgentEvalCaseRequest(name, null, expectation,
            op is null ? null : [new AiAgentEvalRuleDto(op, "393")])).IsValid.Should().Be(valid);

    [Fact]
    public async Task CreateCase_RefusesMoreThanTheMaximum()
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(Saved());
        _repo.Setup(r => r.ListEvalCasesAsync(7, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Enumerable.Range(1, AgentEvals.MaxCases).Select(i => new AiAgentEvalCase { Id = i }).ToList());
        var act = () => new CreateAiAgentEvalCaseHandler(_repo.Object).Handle(
            new CreateAiAgentEvalCaseCommand(7, 5, "a", new SaveAiAgentEvalCaseRequest("x", Expectation: "y")), default);
        await act.Should().ThrowAsync<InvalidOperationException>();
    }
}
