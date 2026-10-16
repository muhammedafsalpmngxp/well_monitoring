using System.Runtime.CompilerServices;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Agents;

public sealed class AiAgentHandlerTests
{
    private readonly Mock<IAiAgentRepository> _repo = new();
    private readonly Mock<IAgentRuntimeClient> _runtime = new();
    private readonly Mock<IAiService> _ai = new();
    private readonly Mock<IAiUsageRepository> _usage = new();

    private static SaveAiAgentRequest Agent(int steps = 1, string status = "draft") => new(
        "Active Wells Analyst", "drilling data analyst", null, null, "Report active wells",
        Enumerable.Range(1, steps).Select(i => new AiAgentStepDto($"Question {i} for {{{{cluster}}}}")).ToList(),
        [new AiAgentToolDto("db_assistant", "chat")],
        [new AiAgentInputDto("cluster")], null, status);

    private TestAiAgentStreamHandler TestSut => new(_runtime.Object, _repo.Object, _ai.Object, _usage.Object, new TestAiAgentStreamValidator());

    [Fact]
    public async Task Create_SavesTheAgentForTheTenantAndCaller()
    {
        AiAgent? saved = null;
        _repo.Setup(r => r.Add(It.IsAny<AiAgent>())).Callback<AiAgent>(a => saved = a);

        var dto = await new CreateAiAgentHandler(_repo.Object).Handle(new CreateAiAgentCommand(7, "a@b.com", Agent(status: "Published")), default);

        saved!.TenantId.Should().Be(7);
        saved.CreatedBy.Should().Be("a@b.com");
        saved.Status.Should().Be("published");
        dto.Steps.Should().ContainSingle().Which.Text.Should().Be("Question 1 for {{cluster}}");
        dto.Tools.Should().ContainSingle().Which.Agent.Should().Be("db_assistant");
        _repo.Verify(r => r.SaveAsync(default), Times.Once);
    }

    [Fact]
    public async Task Update_ReturnsNull_ForAnotherTenantsAgent()
    {
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync((AiAgent?)null);
        (await new UpdateAiAgentHandler(_repo.Object).Handle(new UpdateAiAgentCommand(7, 5, Agent()), default)).Should().BeNull();
        _repo.Verify(r => r.SaveAsync(default), Times.Never);
    }

    [Fact]
    public async Task List_AddsRunStatsPerAgent()
    {
        var agent = new AiAgent { Id = 3, TenantId = 7, Name = "A", StepsJson = "[{\"text\":\"x\"}]", ToolsJson = "[]" };
        _repo.Setup(r => r.ListAsync(7, default)).ReturnsAsync([agent]);
        _repo.Setup(r => r.StatsAsync(7, default)).ReturnsAsync(new Dictionary<long, AiAgentStatsDto> { [3] = new(4, 75, 12.5, null) });

        var list = await new ListAiAgentsHandler(_repo.Object).Handle(new ListAiAgentsQuery(7), default);

        list.Should().ContainSingle().Which.Stats.Runs.Should().Be(4);
    }

    [Fact]
    public async Task Tools_ReturnsMessage_WhenRuntimeIsDown()
    {
        _runtime.Setup(r => r.ListToolsAsync(default)).ThrowsAsync(new HttpRequestException("refused"));
        var tools = await new ListAgentToolsHandler(_runtime.Object).Handle(new ListAgentToolsQuery(), default);
        tools.Tools.Should().BeEmpty();
        tools.Message.Should().Contain("not reachable");
    }

    [Fact]
    public async Task Test_InvalidAgent_YieldsErrorAndRunsNothing()
    {
        var bad = Agent() with { Name = "", Steps = [] };
        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(bad)), default));
        events.Should().ContainSingle().Which.Type.Should().Be("error");
        _runtime.Verify(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), It.IsAny<AgentRuntimeLlm?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Test_PassesProgressThrough_SavesTheRun_AndEndsWithDone()
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => { r.Id = 11; run = r; });
        _runtime.Setup(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), null, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Events(("step", "{\"step\":1,\"phase\":\"start\"}"), ("status", "{\"stage\":\"Fetching your data\"}"),
                ("done", "{\"ok\":true,\"answer\":\"393 wells\",\"steps\":[{\"step\":1}],\"usage\":[]}")));

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com",
            new TestAiAgentRequest(Agent(), new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        events.Select(e => e.Type).Should().Equal("step", "status", "done");
        run!.Status.Should().Be("success");
        run.Answer.Should().Be("393 wells");
        run.InputsJson.Should().Contain("Nimr");
        JsonSerializer.Serialize(events[^1].Data).Should().Contain("\"runId\":11");
        _ai.Verify(a => a.ResolveProviderAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never); // one step: no model call
    }

    [Fact]
    public async Task Test_MultiStep_UsesTenantProvider_AndLogsItsUsage()
    {
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        AgentRuntimeLlm? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), It.IsAny<AgentRuntimeLlm?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<SaveAiAgentRequest, IReadOnlyDictionary<string, string>, AgentRuntimeLlm?, string, CancellationToken>((_, _, l, _, _) => sent = l)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[],\"usage\":[{\"agent\":\"agent_runtime.answer\",\"model\":\"m\",\"input\":50,\"output\":9},{\"agent\":\"db_assistant.sql_author\",\"model\":\"g\",\"input\":1,\"output\":1}]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com",
            new TestAiAgentRequest(Agent(steps: 2), new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        sent.Should().Be(new AgentRuntimeLlm("openai", "http://llm", "m", "key"));
        _usage.Verify(u => u.AddAsync(It.Is<AiUsageLog>(l => l.Purpose == "agent" && l.PromptTokens == 50 && l.UserId == "1"), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Test_AskDataSingleStep_UsesTenantProvider_AndLogsAskDataUsage()
    {
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        AgentRuntimeLlm? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), It.IsAny<AgentRuntimeLlm?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<SaveAiAgentRequest, IReadOnlyDictionary<string, string>, AgentRuntimeLlm?, string, CancellationToken>((_, _, l, _, _) => sent = l)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"393\",\"steps\":[],\"usage\":[{\"agent\":\"askdata.sql_author\",\"model\":\"m\",\"input\":900,\"output\":40},{\"agent\":\"askdata.synthesize\",\"model\":\"m\",\"input\":300,\"output\":20}]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(
            Agent() with { Tools = [new AiAgentToolDto(AgentMapping.AskDataTool, "deep")] },
            new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        sent.Should().NotBeNull();   // Ask Data needs the provider even for one step
        _usage.Verify(u => u.AddAsync(It.Is<AiUsageLog>(l => l.Purpose == "agent"), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public void Validator_RejectsAskDataRowLimitOutOfRange()
    {
        new SaveAiAgentRequestValidator().Validate(Agent() with { AskData = new AiAgentAskDataDto(MaxRows: 0) }).IsValid.Should().BeFalse();
        new SaveAiAgentRequestValidator().Validate(Agent() with { AskData = new AiAgentAskDataDto(MaxRows: 200) }).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Test_SupervisorSingleStep_StillGetsTheModel()
    {
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        AgentRuntimeLlm? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), It.IsAny<AgentRuntimeLlm?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Callback<SaveAiAgentRequest, IReadOnlyDictionary<string, string>, AgentRuntimeLlm?, string, CancellationToken>((_, _, l, _, _) => sent = l)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[],\"usage\":[]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(
            Agent() with { Type = "supervisor" }, new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        sent.Should().NotBeNull();   // the supervisor decides with the model
    }

    [Theory]
    [InlineData("router", 5, false)]
    [InlineData("supervisor", 0, false)]
    [InlineData("loop", 21, false)]
    [InlineData("parallel", 3, true)]
    public void Validator_ChecksAgentTypeAndIterations(string type, int max, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Type = type, MaxIterations = max }).IsValid.Should().Be(valid);

    [Theory]
    [InlineData("sequential", "b", "equals", true)]
    [InlineData("loop", "answer", "else", true)]
    [InlineData("parallel", "b", "equals", false)]      // routing needs steps that run in order
    [InlineData("sequential", "nowhere", "equals", false)]
    [InlineData("sequential", "b", "between", false)]
    public void Validator_ChecksRouters(string type, string target, string op, bool valid)
    {
        var router = new AiAgentStepDto("By cluster", Id: "r", Kind: "router",
            Branches: [new AiAgentBranchDto("x", "Nimr", "cluster", op, "Nimr", target)]);
        var agent = Agent() with { Type = type, Steps = [router, new AiAgentStepDto("B", Id: "b")] };
        new SaveAiAgentRequestValidator().Validate(agent).IsValid.Should().Be(valid);
    }

    [Fact]
    public void Validator_RejectsRouterWithoutBranches() =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("R", Id: "r", Kind: "router")] })
            .IsValid.Should().BeFalse();

    [Fact]
    public async Task AgentFlowDownload_IsNull_ForAnotherTenantsAgent()
    {
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync((AiAgent?)null);
        (await new GetAgentFlowHandler(_repo.Object, _runtime.Object).Handle(new GetAgentFlowQuery(7, 5), default)).Should().BeNull();
        _runtime.Verify(r => r.ExportAgentFlowAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AgentFlowDownload_ExportsTheSavedAgentWithItsType()
    {
        var saved = new AiAgent { Id = 5, TenantId = 7, Name = "A", Type = "loop", MaxIterations = 3, StepsJson = "[{\"text\":\"x\"}]", ToolsJson = "[]" };
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync(saved);
        SaveAiAgentRequest? exported = null;
        _runtime.Setup(r => r.ExportAgentFlowAsync(It.IsAny<SaveAiAgentRequest>(), default))
            .Callback<SaveAiAgentRequest, CancellationToken>((a, _) => exported = a)
            .ReturnsAsync(JsonSerializer.Deserialize<JsonElement>("{\"framework\":\"langgraph\"}"));

        (await new GetAgentFlowHandler(_repo.Object, _runtime.Object).Handle(new GetAgentFlowQuery(7, 5), default)).Should().NotBeNull();
        exported!.Type.Should().Be("loop");
        exported.MaxIterations.Should().Be(3);
    }

    [Fact]
    public async Task Test_RuntimeDown_SavesFailedRun_AndYieldsError()
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => run = r);
        _runtime.Setup(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), It.IsAny<AgentRuntimeLlm?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Throwing());

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        run!.Status.Should().Be("failed");
        run.Error.Should().Contain("agent service failed");
    }

    [Fact]
    public async Task Test_UnknownSavedAgent_YieldsError()
    {
        _repo.Setup(r => r.GetAsync(7, 99, It.IsAny<CancellationToken>())).ReturnsAsync((AiAgent?)null);
        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent(), null, 99)), default));
        events.Should().ContainSingle().Which.Type.Should().Be("error");
    }

    [Theory]
    [InlineData("bad name")]
    [InlineData("1abc")]
    public void Validator_RejectsInputNamesThatCannotBePlaceholders(string name)
    {
        var result = new SaveAiAgentRequestValidator().Validate(Agent() with { Inputs = [new AiAgentInputDto(name)] });
        result.IsValid.Should().BeFalse();
    }

    [Fact]
    public async Task Test_PageLeavesMidRun_RunIsStillSavedAsStopped()
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => run = r);
        _runtime.Setup(r => r.RunAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<IReadOnlyDictionary<string, string>>(), It.IsAny<AgentRuntimeLlm?>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Events(("step", "{\"step\":1,\"phase\":\"start\"}"), ("ping", "{}"), ("done", "{\"ok\":true,\"answer\":\"x\"}")));

        await foreach (var _ in TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default))
            break;   // the page closes after the first event

        run.Should().NotBeNull();
        run!.Status.Should().Be("failed");
        run.Error.Should().StartWith("Stopped:");
    }

    [Theory]
    [InlineData("tok", "xlsx", true)]
    [InlineData("tok", "docx", true)]
    [InlineData("", "xlsx", false)]
    [InlineData("tok", "csv", false)]
    public void ExportValidator_ChecksTokenAndFormat(string token, string format, bool valid) =>
        new ExportAskDataQueryValidator().Validate(new ExportAskDataQuery(new AskDataExportRequest(token, format))).IsValid.Should().Be(valid);

    [Fact]
    public async Task ExportAskData_ReturnsTheRuntimeFile()
    {
        var file = new AskDataExportFile([1, 2], "application/x", "a.xlsx");
        _runtime.Setup(r => r.ExportAskDataAsync(It.IsAny<AskDataExportRequest>(), default)).ReturnsAsync(file);
        (await new ExportAskDataHandler(_runtime.Object).Handle(new ExportAskDataQuery(new AskDataExportRequest("t")), default))
            .Should().BeSameAs(file);
    }

    private static async IAsyncEnumerable<AgentRuntimeEvent> Events(params (string Type, string Json)[] items)
    {
        foreach (var (type, json) in items)
        {
            await Task.Yield();
            yield return new AgentRuntimeEvent(type, JsonSerializer.Deserialize<JsonElement>(json));
        }
    }

    private static async IAsyncEnumerable<AgentRuntimeEvent> Throwing([EnumeratorCancellation] CancellationToken ct = default)
    {
        await Task.Yield();
        throw new HttpRequestException("refused");
#pragma warning disable CS0162
        yield break;
#pragma warning restore CS0162
    }

    private static async Task<List<AiAskEvent>> Collect(IAsyncEnumerable<AiAskEvent> source)
    {
        var list = new List<AiAskEvent>();
        await foreach (var e in source) list.Add(e);
        return list;
    }
}
