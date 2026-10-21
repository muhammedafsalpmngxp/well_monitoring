using System.Runtime.CompilerServices;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Agents;

public sealed class AiAgentHandlerTests
{
    private readonly Mock<IAiAgentRepository> _repo = new();
    private readonly Mock<IAgentRuntimeClient> _runtime = new();
    private readonly Mock<IAiService> _ai = new();
    private readonly Mock<IAiUsageRepository> _usage = new();
    private readonly Mock<IAiProviderRepository> _providers = new();
    private readonly Mock<IAiPromptStore> _prompts = new();
    private readonly Mock<IAiSettingsRepository> _settings = new();
    private static readonly IReadOnlyDictionary<string, string> Prompts = new Dictionary<string, string>
    {
        ["agent.supervisor"] = "Pick the next step.", ["askdata.sql_rules"] = "Rules.", [AiPrompts.Answer] = "not for the runtime",
    };
    /// <summary>"Encrypts" by prefixing, so the tests can read what was stored.</summary>
    private readonly Mock<IAiKeyProtector> _keys = new();

    public AiAgentHandlerTests()
    {
        _keys.Setup(k => k.Protect(It.IsAny<string>())).Returns<string>(v => "enc:" + v);
        _keys.Setup(k => k.Unprotect(It.IsAny<string>())).Returns<string>(v => v[4..]);
        _prompts.Setup(p => p.GetAsync(It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync(Prompts);
    }

    private static SaveAiAgentRequest Agent(int steps = 1, string status = "draft") => new(
        "Active Wells Analyst", "drilling data analyst", null, null, "Report active wells",
        Enumerable.Range(1, steps).Select(i => new AiAgentStepDto($"Question {i} for {{{{cluster}}}}")).ToList(),
        [new AiAgentToolDto("db_assistant", "chat")],
        [new AiAgentInputDto("cluster")], null, status);

    private TestAiAgentStreamHandler TestSut => new(_runtime.Object, _repo.Object, _ai.Object, _usage.Object, new TestAiAgentStreamValidator(),
        _prompts.Object, _settings.Object, _keys.Object, new ResumeAiAgentRunStreamValidator());

    [Fact]
    public async Task Create_SavesTheAgentForTheTenantAndCaller()
    {
        AiAgent? saved = null;
        _repo.Setup(r => r.Add(It.IsAny<AiAgent>())).Callback<AiAgent>(a => saved = a);

        var dto = await new CreateAiAgentHandler(_repo.Object, _keys.Object).Handle(new CreateAiAgentCommand(7, "a@b.com", Agent(status: "Published")), default);

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
        (await new UpdateAiAgentHandler(_repo.Object, _keys.Object).Handle(new UpdateAiAgentCommand(7, 5, "a@b.com", Agent()), default)).Should().BeNull();
        _repo.Verify(r => r.SaveAsync(default), Times.Never);
    }

    [Fact]
    public async Task SetState_SwitchesTheAgentOff_AndReturnsIt()
    {
        var agent = new AiAgent { Id = 5, TenantId = 7, Name = "Pegging Agent" };
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync(agent);
        _repo.Setup(r => r.StatsAsync(7, default)).ReturnsAsync(new Dictionary<long, AiAgentStatsDto>());

        var dto = await new SetAiAgentStateHandler(_repo.Object).Handle(new SetAiAgentStateCommand(7, 5, AgentMapping.Inactive), default);

        dto!.AgentState.Should().Be("inactive");
        agent.AgentState.Should().Be("inactive");
        _repo.Verify(r => r.SaveAsync(default), Times.Once);
    }

    [Fact]
    public async Task Update_KeepsTheAgentState()
    {
        var agent = new AiAgent { Id = 5, TenantId = 7, AgentState = AgentMapping.Inactive };
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync(agent);
        _repo.Setup(r => r.StatsAsync(7, default)).ReturnsAsync(new Dictionary<long, AiAgentStatsDto>());

        await new UpdateAiAgentHandler(_repo.Object, _keys.Object).Handle(new UpdateAiAgentCommand(7, 5, "a@b.com", Agent(status: "published")), default);

        agent.AgentState.Should().Be("inactive");   // saving or publishing never switches an agent back on
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
        _runtime.Verify(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Test_PassesProgressThrough_SavesTheRun_AndEndsWithDone()
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => { r.Id = 11; run = r; });
        _runtime.Setup(r => r.RunAsync(It.Is<AgentRunContext>(c => c.Llm == null), It.IsAny<CancellationToken>()))
            .Returns(Events(("step", "{\"step\":1,\"phase\":\"start\"}"), ("status", "{\"stage\":\"Fetching your data\"}"),
                ("done", "{\"ok\":true,\"answer\":\"393 wells\",\"steps\":[{\"step\":1}],\"usage\":[]}")));

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com",
            new TestAiAgentRequest(Agent(), new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        events.Select(e => e.Type).Should().Equal("step", "status", "done");
        run!.Status.Should().Be("success");
        run.Answer.Should().Be("393 wells");
        run.InputsJson.Should().Contain("Nimr");
        run.InputTokens.Should().BeNull();   // no model call on the tenant's provider
        run.OutputTokens.Should().BeNull();
        run.TotalTokens.Should().BeNull();
        JsonSerializer.Serialize(events[^1].Data).Should().Contain("\"runId\":11");
        _ai.Verify(a => a.ResolveProviderAsync(It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never); // one step: no model call
    }

    [Fact]
    public async Task Test_SendsTheTenantsRuntimePrompts_FromTheDatabase()
    {
        IReadOnlyDictionary<string, string>? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.Prompts)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[],\"usage\":[]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default));

        _prompts.Verify(p => p.GetAsync(7, It.IsAny<CancellationToken>()), Times.Once);
        sent.Should().NotBeNull();
        sent!.Keys.Should().BeEquivalentTo("agent.supervisor", "askdata.sql_rules");   // the AI-feature prompts stay in the Tenant API
        sent["agent.supervisor"].Should().Be("Pick the next step.");
    }

    [Fact]
    public async Task Test_SendsTheTenantsAskDataSettings_FromAiSettings()
    {
        _settings.Setup(x => x.GetAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new AiSettings
        {
            TenantId = 7, AskDataAllowedSchemas = "[\"well\",\"dbo\"]", AskDataExcludedTables = "[\"dbo.secret\"]", AskDataMaxRows = 200,
        });
        AgentRuntimeAskData? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.AskData)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[],\"usage\":[]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default));

        sent.Should().NotBeNull();
        sent!.AllowedSchemas.Should().Equal("well", "dbo");
        sent.ExcludedTables.Should().Equal("dbo.secret");
        sent.MaxRows.Should().Be(200);
    }

    [Fact]
    public async Task Test_MultiStep_UsesTenantProvider_AndLogsItsUsage()
    {
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => r.Id = 11);
        _repo.Setup(r => r.GetAsync(7, 3, It.IsAny<CancellationToken>())).ReturnsAsync(new AiAgent { Id = 3, TenantId = 7 });
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        AgentRuntimeLlm? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.Llm)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[],\"usage\":[{\"agent\":\"agent_runtime.answer\",\"model\":\"m\",\"input\":50,\"output\":9},{\"agent\":\"db_assistant.sql_author\",\"model\":\"g\",\"input\":1,\"output\":1}]}")));

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com",
            new TestAiAgentRequest(Agent(steps: 2), new Dictionary<string, string> { ["cluster"] = "Nimr" }, AgentId: 3)), default));

        sent.Should().Be(new AgentRuntimeLlm("openai", "http://llm", "m", "key"));
        // Tagged with its agent and run, so the cards and the Activity Log can show what each agent used.
        _usage.Verify(u => u.AddAsync(It.Is<AiUsageLog>(l => l.Purpose == "agent:3:11" && l.PromptTokens == 50 && l.UserId == "1"), It.IsAny<CancellationToken>()), Times.Once);
        // Saved on the run itself (input_tokens / output_tokens): only the tenant provider's call, 50 in and 9 out.
        _repo.Verify(r => r.AddRunAsync(It.Is<AiAgentRun>(x => x.InputTokens == 50 && x.OutputTokens == 9 && x.TotalTokens == 59), It.IsAny<CancellationToken>()), Times.Once);
        var done = JsonSerializer.Serialize(events[^1].Data, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        done.Should().Contain("\"llm\":{\"calls\":1,\"promptTokens\":50,\"completionTokens\":9");
    }

    [Fact]
    public async Task Test_AskDataSingleStep_UsesTenantProvider_AndLogsAskDataUsage()
    {
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => r.Id = 11);
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        AgentRuntimeLlm? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.Llm)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"393\",\"steps\":[],\"usage\":[{\"agent\":\"askdata.sql_author\",\"model\":\"m\",\"input\":900,\"output\":40},{\"agent\":\"askdata.synthesize\",\"model\":\"m\",\"input\":300,\"output\":20}]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(
            Agent() with { Tools = [new AiAgentToolDto(AgentMapping.AskDataTool, "deep")] },
            new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        sent.Should().NotBeNull();   // Ask Data needs the provider even for one step
        _usage.Verify(u => u.AddAsync(It.Is<AiUsageLog>(l => l.Purpose == "agent:0:11"), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public void Notes_AreStoredAndReturned_AndColoursChecked()
    {
        var agent = new AiAgent();
        var notes = new[] { new AiAgentNoteDto("n1", "Why this router", 10, 20, "blue") };
        AgentMapping.Apply(agent, Agent() with { Notes = notes }, _keys.Object);
        AgentMapping.ToDto(agent, null).Notes.Should().BeEquivalentTo(notes);
        new SaveAiAgentRequestValidator().Validate(Agent() with { Notes = [notes[0] with { Color = "red" }] }).IsValid.Should().BeFalse();
    }

    [Fact]
    public void Validator_RejectsAskDataRowLimitOutOfRange()
    {
        new SaveAiAgentRequestValidator().Validate(Agent() with { AskData = new AiAgentAskDataDto(MaxRows: 0) }).IsValid.Should().BeFalse();
        new SaveAiAgentRequestValidator().Validate(Agent() with { AskData = new AiAgentAskDataDto(MaxRows: 200) }).IsValid.Should().BeTrue();
    }

    private static SaveAiAgentRequest SqlAgent(string? sql, string action = "table") => Agent() with
    {
        Steps = [new AiAgentStepDto("Recent report dates", Sql: sql)],
        Tools = [new AiAgentToolDto(AgentMapping.SqlQueryTool, action)],
    };

    private const string ReportSql = "-- daily report\nSELECT TOP 10 report_date FROM dbo.daily_report WHERE cluster = {{cluster}}";

    [Theory]
    [InlineData(ReportSql, "table", null)]
    [InlineData("WITH d AS (SELECT 1 AS n) SELECT n FROM d", "summary", null)]
    [InlineData("  ", "table", "write its SQL")]
    [InlineData("DELETE FROM dbo.daily_report", "table", "must be one SELECT")]
    [InlineData("SELECT a FROM dbo.t WHERE w = {{well}}", "table", "{{well}}, which is not an input")]
    [InlineData(ReportSql, "chart", "table or summary")]
    [InlineData("SELECT a FROM dbo.t WHERE n LIKE '%{{cluster}}%'", "table", "cannot be a parameter")]
    [InlineData("SELECT a FROM dbo.t -- for {{cluster}}", "table", "cannot be a parameter")]
    [InlineData("SELECT a FROM dbo.t WHERE n LIKE '%' + {{cluster}} + '%' AND c = '{{cluster}}'", "table", null)]
    public void Validator_ChecksSavedSqlSteps(string sql, string action, string? error)
    {
        var result = new SaveAiAgentRequestValidator().Validate(SqlAgent(sql, action));
        result.IsValid.Should().Be(error is null);
        if (error is not null) result.Errors.Should().Contain(e => e.ErrorMessage.Contains(error));
    }

    [Fact]
    public void Validator_LeavesSqlOfOtherToolsAlone() =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("Q {{cluster}}", Sql: "not checked")] })
            .IsValid.Should().BeTrue();

    [Fact]
    public void Mapping_SavedSqlStepsUseTheDatabase_AndSummaryNeedsTheModel()
    {
        AgentMapping.UsesDatabase(SqlAgent(ReportSql)).Should().BeTrue();
        AgentMapping.SummarisesSql(SqlAgent(ReportSql)).Should().BeFalse();
        AgentMapping.SummarisesSql(SqlAgent(ReportSql, "summary")).Should().BeTrue();
        AgentMapping.UsesDatabase(Agent()).Should().BeFalse();
        // A step with its own tool counts too, whatever the agent's first tool is.
        AgentMapping.UsesDatabase(Agent() with
        {
            Steps = [new AiAgentStepDto("Q", Tool: new AiAgentToolDto(AgentMapping.SqlQueryTool, "table"), Sql: ReportSql)],
        }).Should().BeTrue();
    }

    [Fact]
    public async Task Create_SavesTheStepSql_Trimmed()
    {
        AiAgent? saved = null;
        _repo.Setup(r => r.Add(It.IsAny<AiAgent>())).Callback<AiAgent>(a => saved = a);
        var dto = await new CreateAiAgentHandler(_repo.Object, _keys.Object).Handle(new CreateAiAgentCommand(7, "a@b.com", SqlAgent($"  {ReportSql}  ")), default);
        dto.Steps.Should().ContainSingle().Which.Sql.Should().Be(ReportSql);
        saved!.StepsJson.Should().Contain("\"sql\":");
    }

    [Theory]
    [InlineData("table", false)]
    [InlineData("summary", true)]
    public async Task Test_SavedSqlSingleStep_GetsTheModelOnlyToSummarise(string action, bool model)
    {
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"| report_date |\",\"steps\":[],\"usage\":[]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(
            SqlAgent(ReportSql, action), new Dictionary<string, string> { ["cluster"] = "Nimr" })), default));

        _ai.Verify(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()), model ? Times.Once() : Times.Never());
    }

    private const string SetupSql = "SELECT wm.well_id FROM well.well_master AS wm WHERE wm.well_id = TRY_CONVERT(int, {{cluster}})";

    private static SaveAiAgentRequest SetupAgent(params AiAgentStepDto[] steps) => SqlAgent(ReportSql) with { Steps = steps };

    [Fact]
    public void Validator_AcceptsASetupStepFirst()
    {
        var agent = SetupAgent(new AiAgentStepDto("Resolve", Kind: AgentMapping.SetupKind, Sql: SetupSql), new AiAgentStepDto("Report", Sql: ReportSql));
        new SaveAiAgentRequestValidator().Validate(agent).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData("second", "Only the first step")]
    [InlineData("askdata", "must use Saved SQL")]
    [InlineData("alone", "at least one step after")]
    [InlineData("linked-back", "go back to the setup step")]
    public void Validator_ChecksTheSetupStep(string shape, string error)
    {
        var setup = new AiAgentStepDto("Resolve", Kind: AgentMapping.SetupKind, Sql: SetupSql, Id: "s");
        var agent = shape switch
        {
            "second" => SetupAgent(new AiAgentStepDto("Report", Sql: ReportSql), setup),
            "askdata" => SetupAgent(setup with { Tool = new AiAgentToolDto(AgentMapping.AskDataTool, "deep") }, new AiAgentStepDto("Report", Sql: ReportSql)),
            "alone" => SetupAgent(setup),
            _ => SetupAgent(setup, new AiAgentStepDto("Report", Sql: ReportSql, Id: "r", Next: "s")) with { Type = "sequential" },
        };
        new SaveAiAgentRequestValidator().Validate(agent).Errors.Should().Contain(e => e.ErrorMessage.Contains(error));
    }

    [Theory]
    [InlineData("slippage for well 35543", true)]
    [InlineData("  ", false)]
    public async Task Test_AQuestionGetsTheModel_AndItsReadingIsCounted(string question, bool model)
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => run = r);
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m", FastModel = "f" }, "key"));
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Returns(Events(("inputs", "{\"by\":\"question\",\"values\":{\"cluster\":\"Nimr\"}}"),
                ("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[],\"usage\":[{\"agent\":\"agent_runtime.inputs\",\"model\":\"f\",\"input\":30,\"output\":8}]}")));
        var agent = SqlAgent(ReportSql) with { Inputs = [new AiAgentInputDto("question", Required: false), new AiAgentInputDto("cluster")] };

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(
            agent, new Dictionary<string, string> { ["question"] = question })), default));

        _ai.Verify(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()), model ? Times.Once() : Times.Never());
        events.Select(e => e.Type).Should().Equal("inputs", "done");   // "Understood as" reaches the page
        run!.InputTokens.Should().Be(30);
        run.OutputTokens.Should().Be(8);
    }

    [Fact]
    public async Task Test_SupervisorSingleStep_StillGetsTheModel()
    {
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        AgentRuntimeLlm? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.Llm)
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

    [Theory]
    [InlineData("sequential", "a", false)]   // c links back to a
    [InlineData("loop", "a", false)]         // a loop repeats through its check, not through a link
    [InlineData("sequential", "answer", true)]
    [InlineData("parallel", null, true)]     // parallel steps are not linked
    public void Validator_RejectsLinksThatGoRoundInACircle(string type, string? lastNext, bool valid)
    {
        var agent = Agent() with
        {
            Type = type,
            Steps = [new AiAgentStepDto("A", Id: "a"), new AiAgentStepDto("B", Id: "b"), new AiAgentStepDto("C", Id: "c", Next: lastNext)],
        };
        var result = new SaveAiAgentRequestValidator().Validate(agent);
        result.IsValid.Should().Be(valid);
        if (!valid) result.Errors.Should().Contain(e => e.ErrorMessage.Contains("round in a circle at 'A'"));
    }

    [Fact]
    public void Validator_AllowsARouterBranchBackToAnEarlierStep()
    {
        // Draft ↔ review: the run caps how often a step is gone back to (maxIterations).
        var router = new AiAgentStepDto("By cluster", Id: "r", Kind: "router",
            Branches: [new AiAgentBranchDto("x", "Nimr", "cluster", "equals", "Nimr", "a"), new AiAgentBranchDto("y", "Else", null, "else", null, "answer")]);
        var agent = Agent() with { Steps = [new AiAgentStepDto("A", Id: "a"), router] };
        new SaveAiAgentRequestValidator().Validate(agent).IsValid.Should().BeTrue();
    }

    [Fact]
    public void SaveValidator_RejectsAStepNothingLinksTo()
    {
        // The Canvas drops a router last; the step before it ends at the answer, so the router never runs.
        var router = new AiAgentStepDto("Decide", Id: "r", Kind: "router",
            Branches: [new AiAgentBranchDto("x", "Otherwise", null, "else", null, "answer")]);
        var agent = Agent() with { Steps = [new AiAgentStepDto("A", Id: "a", Next: "answer"), router] };

        var result = new CreateAiAgentCommandValidator().Validate(new CreateAiAgentCommand(7, "a@b.com", agent));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.ErrorMessage.Contains("'Decide' is never reached"));
        new UpdateAiAgentCommandValidator().Validate(new UpdateAiAgentCommand(7, 1, "a@b.com", agent with
        {
            Steps = [new AiAgentStepDto("A", Id: "a", Next: "r"), router],   // linked: fine
        })).IsValid.Should().BeTrue();
        new TestAiAgentStreamValidator().Validate(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(agent)))
            .IsValid.Should().BeTrue();   // a test run may try a half-built flow
    }

    [Fact]
    public void Validator_ReportsMissingSteps_InsteadOfThrowing() =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = null! }).IsValid.Should().BeFalse();

    [Theory]
    [InlineData("summary", 0.5, 500, true)]
    [InlineData("1bad", null, null, false)]
    [InlineData("cluster", null, null, false)]   // clashes with the input name
    [InlineData(null, 3.0, null, false)]
    [InlineData(null, null, 0, false)]
    public void Validator_ChecksStepAgentFields(string? key, double? temperature, int? maxTokens, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with
        {
            Steps = [new AiAgentStepDto("Q", OutputKey: key, Temperature: temperature, MaxTokens: maxTokens)],
        }).IsValid.Should().Be(valid);

    [Fact]
    public void Validator_RejectsRouterWithoutBranches() =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("R", Id: "r", Kind: "router")] })
            .IsValid.Should().BeFalse();

    [Fact]
    public async Task AgentFlowDownload_IsNull_ForAnotherTenantsAgent()
    {
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync((AiAgent?)null);
        (await new GetAgentFlowHandler(_repo.Object, _runtime.Object, _providers.Object).Handle(new GetAgentFlowQuery(7, 5), default)).Should().BeNull();
        _runtime.Verify(r => r.ExportAgentFlowAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<AgentFlowLlm?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AgentFlowDownload_ExportsTheSavedAgentWithItsType()
    {
        var saved = new AiAgent { Id = 5, TenantId = 7, Name = "A", Type = "loop", MaxIterations = 3, StepsJson = "[{\"text\":\"x\"}]", ToolsJson = "[]" };
        _repo.Setup(r => r.GetAsync(7, 5, default)).ReturnsAsync(saved);
        _providers.Setup(p => p.GetActiveAsync(7, default))
            .ReturnsAsync(new AiProvider { Provider = "azure", Model = "gpt-5", BaseUrl = "https://x", ApiKeyEncrypted = "secret" });
        SaveAiAgentRequest? exported = null;
        AgentFlowLlm? model = null;
        _runtime.Setup(r => r.ExportAgentFlowAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<AgentFlowLlm?>(), default))
            .Callback<SaveAiAgentRequest, AgentFlowLlm?, CancellationToken>((a, l, _) => (exported, model) = (a, l))
            .ReturnsAsync(JsonSerializer.Deserialize<JsonElement>("{\"framework\":\"langgraph\"}"));

        (await new GetAgentFlowHandler(_repo.Object, _runtime.Object, _providers.Object).Handle(new GetAgentFlowQuery(7, 5), default)).Should().NotBeNull();
        exported!.Type.Should().Be("loop");
        exported.MaxIterations.Should().Be(3);
        model.Should().Be(new AgentFlowLlm("azure", "gpt-5", "https://x"));   // the tenant's model, never its key
    }

    [Fact]
    public async Task AgentFlowExport_WithoutAnActiveProvider_SendsNoModel()
    {
        AgentFlowLlm? model = new("x", "y", null);
        _runtime.Setup(r => r.ExportAgentFlowAsync(It.IsAny<SaveAiAgentRequest>(), It.IsAny<AgentFlowLlm?>(), default))
            .Callback<SaveAiAgentRequest, AgentFlowLlm?, CancellationToken>((_, l, _) => model = l)
            .ReturnsAsync(JsonSerializer.Deserialize<JsonElement>("{}"));
        await new ExportAgentFlowHandler(_runtime.Object, _providers.Object).Handle(new ExportAgentFlowQuery(Agent(), 7), default);
        model.Should().BeNull();
    }

    [Fact]
    public async Task Test_RuntimeDown_SavesFailedRun_AndYieldsError()
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => run = r);
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Returns(Throwing());

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        run!.Status.Should().Be("failed");
        run.Error.Should().Contain("agent service failed");
    }

    [Theory]
    [InlineData("config", "Ask Data has no database")]
    [InlineData("json", "could not be read")]
    public async Task Test_FailureBeforeTheFirstEvent_SavesFailedRun_AndYieldsTheReason(string failure, string message)
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => run = r);
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Returns(Throwing(failure == "config"
                ? new InvalidOperationException("Ask Data has no database: set ConnectionStrings:AlTasnimBI or AgentRuntime:AskDataConnection.")
                : new JsonException("bad")));

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        JsonSerializer.Serialize(events[0].Data).Should().Contain(message);
        run!.Status.Should().Be("failed");
    }

    [Fact]
    public async Task Test_InactiveSavedAgent_IsRefused()
    {
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiAgent { Id = 5, TenantId = 7, AgentState = AgentMapping.Inactive });

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com",
            new TestAiAgentRequest(Agent(), new Dictionary<string, string> { ["cluster"] = "Nimr" }, 5)), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        JsonSerializer.Serialize(events[0].Data).Should().Contain("inactive");
        _runtime.Verify(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()), Times.Never);
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
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
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
        new ExportAskDataQueryValidator().Validate(new ExportAskDataQuery(new AskDataExportRequest(token, format), 7)).IsValid.Should().Be(valid);

    [Fact]
    public async Task ExportAskData_ReturnsTheRuntimeFile()
    {
        var file = new AskDataExportFile([1, 2], "application/x", "a.xlsx");
        _runtime.Setup(r => r.ExportAskDataAsync(It.IsAny<AskDataExportRequest>(), It.IsAny<AgentRuntimeAskData>(), default)).ReturnsAsync(file);
        (await new ExportAskDataHandler(_runtime.Object, _settings.Object).Handle(new ExportAskDataQuery(new AskDataExportRequest("t"), 7), default))
            .Should().BeSameAs(file);
    }

    private static AiAgentCustomToolDto ApiTool(string? secret = null) =>
        new("well_status", "https://api.example.test/wells/{well}", Parameters: [new AiAgentToolParamDto("well")], AuthScheme: "bearer", AuthSecret: secret);

    [Fact]
    public async Task Save_EncryptsTheToolSecret_KeepsItWhenEmpty_AndNeverReturnsIt()
    {
        AiAgent? added = null;
        _repo.Setup(r => r.Add(It.IsAny<AiAgent>())).Callback<AiAgent>(a => added = a);
        var dto = await new CreateAiAgentHandler(_repo.Object, _keys.Object).Handle(new CreateAiAgentCommand(7, "a@b.com",
            Agent() with { CustomTools = [ApiTool("s3cret")], Tools = [new AiAgentToolDto("api", "well_status")] }), default);
        added!.CustomToolsJson.Should().Contain("enc:s3cret");
        dto.CustomTools.Should().ContainSingle().Which.Should().Match<AiAgentCustomToolDto>(t => t.AuthSecret == null && t.HasAuthSecret);

        AgentMapping.Apply(added, Agent() with { CustomTools = [ApiTool("")], Tools = [new AiAgentToolDto("api", "well_status")] }, _keys.Object);
        added.CustomToolsJson.Should().Contain("enc:s3cret");      // empty = keep the stored secret
    }

    [Fact]
    public void WithSecrets_UsesTheSavedSecretWhenTheDraftHasNone()
    {
        var saved = new AiAgent { CustomToolsJson = "[{\"name\":\"well_status\",\"url\":\"https://x.test\",\"authScheme\":\"bearer\",\"authSecret\":\"enc:old\"}]" };
        AgentMapping.WithSecrets([ApiTool()], saved, _keys.Object)![0].AuthSecret.Should().Be("old");
        AgentMapping.WithSecrets([ApiTool("new")], saved, _keys.Object)![0].AuthSecret.Should().Be("new");
    }

    [Theory]
    [InlineData("well_status", "https://api.example.test/x", "GET", true)]
    [InlineData("bad name", "https://api.example.test/x", "GET", false)]
    [InlineData("well_status", "http://api.example.test/x", "GET", false)]
    [InlineData("well_status", "https://api.example.test/x", "TRACE", false)]
    public void Validator_ChecksTools(string name, string url, string method, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with
        {
            CustomTools = [new AiAgentCustomToolDto(name, url, Method: method)], Tools = [new AiAgentToolDto("api", name)],
        }).IsValid.Should().Be(valid);

    [Fact]
    public void Validator_RejectsAStepToolThatIsNotDefined() =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Tools = [new AiAgentToolDto("api", "missing")] }).IsValid.Should().BeFalse();

    private static async IAsyncEnumerable<AgentRuntimeEvent> Events(params (string Type, string Json)[] items)
    {
        foreach (var (type, json) in items)
        {
            await Task.Yield();
            yield return new AgentRuntimeEvent(type, JsonSerializer.Deserialize<JsonElement>(json));
        }
    }

    private static async IAsyncEnumerable<AgentRuntimeEvent> Throwing(Exception? error = null, [EnumeratorCancellation] CancellationToken ct = default)
    {
        await Task.Yield();
        throw error ?? new HttpRequestException("refused");
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

    [Fact]
    public async Task Save_RecordsAVersion_OnlyWhenTheAgentChanged_AndWithoutSecrets()
    {
        AiAgentVersion? last = null;
        _repo.Setup(r => r.GetVersionAsync(7, It.IsAny<long>(), 0, It.IsAny<CancellationToken>())).ReturnsAsync(() => last);
        _repo.Setup(r => r.AddVersionAsync(It.IsAny<AiAgentVersion>(), AgentVersioning.Keep, It.IsAny<CancellationToken>()))
            .Callback<AiAgentVersion, int, CancellationToken>((v, _, _) => last = v).Returns(Task.CompletedTask);
        var agent = new AiAgent { Id = 5, TenantId = 7 };
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(agent);
        _repo.Setup(r => r.StatsAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync(new Dictionary<long, AiAgentStatsDto>());
        _keys.Setup(k => k.Protect(It.IsAny<string>())).Returns("enc");
        var handler = new UpdateAiAgentHandler(_repo.Object, _keys.Object);
        var tool = new AiAgentCustomToolDto("lookup", "https://api.example.com", AuthScheme: "bearer", AuthSecret: "s3cret");
        var request = Agent() with { CustomTools = [tool] };

        await handler.Handle(new UpdateAiAgentCommand(7, 5, "a@b.com", request), default);
        await handler.Handle(new UpdateAiAgentCommand(7, 5, "a@b.com", request with { CustomTools = [tool with { AuthSecret = null }] }), default);
        last!.VersionNo.Should().Be(1);
        last.SnapshotJson.Should().NotContain("s3cret").And.NotContain("enc").And.Contain("\"hasAuthSecret\":true");

        await handler.Handle(new UpdateAiAgentCommand(7, 5, "b@c.com", request with { Name = "Renamed" }), default);
        last.VersionNo.Should().Be(2);
        last.CreatedBy.Should().Be("b@c.com");
    }

    [Fact]
    public async Task Versions_AreNull_ForAnotherTenantsAgent()
    {
        _repo.Setup(r => r.GetAsync(8, 5, It.IsAny<CancellationToken>())).ReturnsAsync((AiAgent?)null);
        (await new ListAiAgentVersionsHandler(_repo.Object).Handle(new ListAiAgentVersionsQuery(8, 5), default)).Should().BeNull();
        _repo.Setup(r => r.GetVersionAsync(8, 5, 3, It.IsAny<CancellationToken>())).ReturnsAsync((AiAgentVersion?)null);
        (await new GetAiAgentVersionHandler(_repo.Object).Handle(new GetAiAgentVersionQuery(8, 5, 3), default)).Should().BeNull();
    }

    [Fact]
    public async Task Test_MemoryAgent_SendsTheSavedMemories_AndKeepsTheNewFacts()
    {
        var saved = new AiAgent { Id = 5, TenantId = 7 };
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(saved);
        _repo.Setup(r => r.ListMemoriesAsync(7, 5, TestAiAgentStreamHandler.MemoryKeep, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiAgentMemory { Text = "Nimr has 393 wells" }]);
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => r.Id = 11);
        IReadOnlyList<AiAgentMemory>? kept = null;
        _repo.Setup(r => r.AddMemoriesAsync(It.IsAny<IReadOnlyList<AiAgentMemory>>(), TestAiAgentStreamHandler.MemoryKeep, It.IsAny<CancellationToken>()))
            .Callback<IReadOnlyList<AiAgentMemory>, int, CancellationToken>((m, _, _) => kept = m).Returns(Task.CompletedTask);
        IReadOnlyList<string>? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.Memories)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"393\",\"steps\":[],\"memories\":[\"Rig 7 is in Nimr\",\" \"]}")));
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        var agent = Agent() with { Steps = [new AiAgentStepDto("How many wells in Nimr?", new AiAgentToolDto("load_memory", "search"))] };

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "u1", "a@b.com", new TestAiAgentRequest(agent, null, 5)), default));

        sent.Should().Equal("Nimr has 393 wells");
        kept!.Select(m => (m.Text, m.AgentId, m.RunId)).Should().Equal(("Rig 7 is in Nimr", 5L, (long?)11));
    }

    [Theory]
    [InlineData("loop", true)]
    [InlineData("sequential", false)]
    public void Validator_AllowsExitLoopOnlyInLoopAgents(string type, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Type = type, Steps = [new AiAgentStepDto("A"), new AiAgentStepDto("Stop?", new AiAgentToolDto("exit_loop", "check"))] })
            .IsValid.Should().Be(valid);

    [Fact]
    public async Task Test_SubAgent_SendsThePublishedAgentWithTheRun()
    {
        _repo.Setup(r => r.GetAsync(7, 9, It.IsAny<CancellationToken>())).ReturnsAsync(new AiAgent { Id = 9, TenantId = 7, Name = "Counter", Status = "published",
            StepsJson = "[{\"text\":\"Count wells in {{cluster}}\"}]", ToolsJson = "[{\"agent\":\"ask_data\",\"action\":\"deep\"}]" });
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>())).ReturnsAsync((new AiProvider { Provider = "openai", BaseUrl = "http://llm", Model = "m" }, "key"));
        IReadOnlyDictionary<string, SaveAiAgentRequest>? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c.Subagents)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[]}")));
        var lead = Agent() with { Steps = [new AiAgentStepDto("Nimr", new AiAgentToolDto("subagent", "9"))] };

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(lead)), default));

        sent!.Keys.Should().Equal("9");
        sent["9"].Steps[0].Text.Should().Be("Count wells in {{cluster}}");
    }

    [Theory]
    [InlineData("draft", "is not a published agent")]
    [InlineData("self", "cannot run itself")]
    public async Task Test_SubAgent_RefusesUnpublishedOrItself(string kind, string message)
    {
        var lead = Agent() with { Steps = [new AiAgentStepDto("x", new AiAgentToolDto("subagent", kind == "self" ? "5" : "9"))] };
        _repo.Setup(r => r.GetAsync(7, 5, It.IsAny<CancellationToken>())).ReturnsAsync(new AiAgent { Id = 5, TenantId = 7, Status = "published" });
        _repo.Setup(r => r.GetAsync(7, 9, It.IsAny<CancellationToken>())).ReturnsAsync(new AiAgent { Id = 9, TenantId = 7, Status = "draft" });

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(lead, null, 5)), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        JsonSerializer.Serialize(events[0].Data).Should().Contain(message);
    }

    [Theory]
    [InlineData("wells", true)]
    [InlineData("nothing", false)]
    public void Validator_ForEachNamesAnInputOrAnOutputKey(string forEach, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("List wells", OutputKey: "wells"),
            new AiAgentStepDto("Review {{item}}", ForEach: forEach)] }).IsValid.Should().Be(valid);

    [Fact]
    public async Task Test_ApprovalPause_RecordsAWaitingRun_AndResumeFinishesIt()
    {
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => { r.Id = 11; run = r; });
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Returns(Events(("approval", "{\"token\":\"agent-7-abc\",\"step\":2,\"question\":\"Approve?\",\"draft\":\"Hello\",\"steps\":[{\"step\":1}],\"state\":{\"results\":[{\"step\":1}]},\"node\":\"step_2\"}")));
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("none"));

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent())), default));

        events.Select(e => e.Type).Should().Equal("approval");
        run!.Status.Should().Be("waiting");
        JsonSerializer.Serialize(events[0].Data).Should().Contain("\"runId\":11").And.Contain("\"draft\":\"Hello\"");

        _repo.Setup(r => r.GetRunAsync(7, 11, It.IsAny<CancellationToken>())).ReturnsAsync(run);
        _runtime.Setup(r => r.ResumeAsync(It.Is<AgentRunContext>(c => c.SessionId == "agent-7-abc"),
                It.Is<AgentResume>(x => x.Node == "step_2" && x.Decision == "edit" && x.Text == "Hi" && x.By == "b@c.com"
                    && x.State.GetProperty("results").GetArrayLength() == 1), It.IsAny<CancellationToken>()))
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"Hi sent\",\"steps\":[]}")));
        var rest = await Collect(TestSut.Handle(new ResumeAiAgentRunStream(7, "2", "b@c.com", 11, new ResumeAiAgentRunRequest("agent-7-abc", "edit", "Hi")), default));

        rest.Select(e => e.Type).Should().Equal("done");
        run.Status.Should().Be("success");
        run.Answer.Should().Be("Hi sent");
        run.ResumeJson.Should().BeNull();
        _repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("agent-8-abc", "approve", "does not belong")]
    [InlineData("agent-7-abc", "maybe", "approve, edit or reject")]
    [InlineData("agent-7-abc", "approve", "not waiting")]
    public async Task Resume_RefusesAnotherTenantsToken_ABadDecision_OrARunNotWaiting(string token, string decision, string message)
    {
        _repo.Setup(r => r.GetRunAsync(7, 11, It.IsAny<CancellationToken>())).ReturnsAsync(new AiAgentRun { Id = 11, TenantId = 7, Status = "success" });

        var events = await Collect(TestSut.Handle(new ResumeAiAgentRunStream(7, "2", "b@c.com", 11, new ResumeAiAgentRunRequest(token, decision)), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        JsonSerializer.Serialize(events[0].Data).Should().Contain(message);
        _runtime.Verify(r => r.ResumeAsync(It.IsAny<AgentRunContext>(), It.IsAny<AgentResume>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Test_ModelSteps_ReportWhyTheProviderCannotBeUsed()
    {
        _ai.Setup(a => a.ResolveProviderAsync(7, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Connection password cannot be decrypted."));
        var agent = Agent() with { Steps = [new AiAgentStepDto("How many wells?", new AiAgentToolDto("ask_data", "deep"))] };

        var events = await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(agent)), default));

        events.Should().ContainSingle().Which.Type.Should().Be("error");
        JsonSerializer.Serialize(events[0].Data).Should().Contain("The AI provider cannot be used: Connection password cannot be decrypted.");
    }

    [Fact]
    public async Task Test_AThread_GivesTheEarlierAnswersToTheRun_AndRecordsTheThread()
    {
        _repo.Setup(r => r.ListThreadAsync(7, "conv-1", TestAiAgentStreamHandler.ThreadTurns, It.IsAny<CancellationToken>()))
            .ReturnsAsync([new AiAgentRun { InputsJson = "{\"cluster\":\"Nimr\"}", Answer = "393 wells" }]);
        AiAgentRun? run = null;
        _repo.Setup(r => r.AddRunAsync(It.IsAny<AiAgentRun>(), It.IsAny<CancellationToken>())).Callback<AiAgentRun, CancellationToken>((r, _) => run = r);
        AgentRunContext? sent = null;
        _runtime.Setup(r => r.RunAsync(It.IsAny<AgentRunContext>(), It.IsAny<CancellationToken>()))
            .Callback<AgentRunContext, CancellationToken>((c, _) => sent = c)
            .Returns(Events(("done", "{\"ok\":true,\"answer\":\"x\",\"steps\":[]}")));

        await Collect(TestSut.Handle(new TestAiAgentStream(7, "1", "a@b.com", new TestAiAgentRequest(Agent(), new() { ["cluster"] = "Lekhwair" }, null, "conv-1")), default));

        sent!.Thread.Should().Equal(new AgentThreadTurn("Nimr", "393 wells"));
        run!.ThreadId.Should().Be("conv-1");
    }

    [Theory]
    [InlineData("supervisor", true)]
    [InlineData("parallel", false)]
    public void Validator_AllowsApprovalInSupervisorButNotParallel(string type, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Type = type, Steps = [new AiAgentStepDto("Draft"), new AiAgentStepDto("OK?", new AiAgentToolDto("approval", "review"))] })
            .IsValid.Should().Be(valid);

    [Theory]
    [InlineData(3, true)]
    [InlineData(9, false)]
    public void Validator_ChecksRetries(int retries, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("Count", Retries: retries)] }).IsValid.Should().Be(valid);

    [Fact]
    public void Usage_IsAddedUpPerModel()
    {
        var done = JsonSerializer.Deserialize<JsonElement>("{\"usage\":[{\"agent\":\"askdata.sql_author\",\"model\":\"big\",\"calls\":1,\"input\":900,\"output\":40},"
            + "{\"agent\":\"agent_runtime.answer\",\"model\":\"big\",\"calls\":1,\"input\":300,\"output\":60},{\"agent\":\"askdata.route\",\"model\":\"mini\",\"input\":50,\"output\":5},{\"agent\":\"x\"}]}");

        AgentMapping.Usage(done).Should().Equal(new AgentModelUsage("big", 2, 1200, 100), new AgentModelUsage("mini", 1, 50, 5));
    }

    [Theory]
    [InlineData("sequential", "{\"retryFrom\":\"a\"}", true)]
    [InlineData("parallel", null, false)]
    [InlineData("sequential", "{\"retryFrom\":\"c\"}", false)]
    [InlineData("sequential", "[1]", false)]
    public void Validator_ChecksTheNewNodes(string type, string? options, bool valid)
    {
        var opts = options is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(options);
        new SaveAiAgentRequestValidator().Validate(Agent() with { Type = type, Steps = [new AiAgentStepDto("Draft", Id: "a"),
            new AiAgentStepDto("Has the count", new AiAgentToolDto("evaluator", "check"), Id: "b", Options: opts), new AiAgentStepDto("Next", Id: "c")] })
            .IsValid.Should().Be(valid);
    }

    [Theory]
    [InlineData("math", true)]
    [InlineData("python", false)]
    public void Validator_ChecksComputeModes(string mode, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("{{a}} + 1", new AiAgentToolDto("compute", "run"),
            Options: JsonSerializer.Deserialize<JsonElement>($"{{\"mode\":\"{mode}\"}}"))] }).IsValid.Should().Be(valid);

    [Theory]
    [InlineData("answer", false)]
    [InlineData("start", false)]
    [InlineData("reply", true)]
    public void Validator_ReservesTheCanvasNodeIds(string id, bool valid) =>
        new SaveAiAgentRequestValidator().Validate(Agent() with { Steps = [new AiAgentStepDto("Q", Id: id)] }).IsValid.Should().Be(valid);
}
