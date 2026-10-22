using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>
/// Daily Report's AI around the agent runtime: the report date's saved answers go with every request, a new verified
/// answer is saved (also from the streamed brief), and the background worker prepares the day brief of the users' today.
/// </summary>
public class DailyReportAgentTests
{
    private const string Key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static readonly DateOnly Day = new(2026, 10, 21);
    private static readonly DateOnly Today = new(2026, 10, 22);

    private static JsonElement J(string json) => JsonSerializer.Deserialize<JsonElement>(json);

    private static readonly JsonElement Verified = J($$"""
        {"explanation":"Well 101 reported 1 task.","verified":true,"cached":false,"answer_key":"{{Key}}","model":"luna",
         "verification":{"passed":true,"issues":[]},"usage":[{"agent":"dailyreport.day_writer","model":"luna","input":10,"output":5}]}
        """);

    private sealed class World
    {
        public readonly Mock<IAgenticFeatureContext> Context = new();
        public readonly Mock<IAgentRuntimeClient> Runtime = new();
        public readonly Mock<IAiUsageRepository> Usage = new();
        public readonly Mock<IAiFeatureAnswerStore> Answers = new();
        public readonly List<string> Paths = [];
        public readonly List<JsonElement> Bodies = [];
        public readonly List<(JsonElement Reply, int Keep, string? User)> Saved = [];

        public World(JsonElement reply, params AgentRuntimeEvent[] stream)
        {
            var envelope = new AgenticFeatureEnvelope(null, new Dictionary<string, string>(),
                new Dictionary<string, JsonElement> { ["savedAnswersPerDate"] = J("5") }, FeatureAccessDto.Empty,
                new Dictionary<string, FeatureQueryPayload>());
            Context.Setup(c => c.BuildAsync(7, AgenticFeatureCatalog.DailyReport, true, It.IsAny<CancellationToken>())).ReturnsAsync(envelope);
            Runtime.Setup(r => r.FeatureCallAsync("dailyreport", It.IsAny<string>(), envelope, It.IsAny<object?>(), It.IsAny<CancellationToken>()))
                .Callback<string, string, AgenticFeatureEnvelope, object?, CancellationToken>((_, p, _, b, _) => Record(p, b))
                .ReturnsAsync(reply);
            Runtime.Setup(r => r.FeatureStreamAsync("dailyreport", It.IsAny<string>(), envelope, It.IsAny<object?>(), It.IsAny<CancellationToken>()))
                .Callback<string, string, AgenticFeatureEnvelope, object?, CancellationToken>((_, p, _, b, _) => Record(p, b))
                .Returns(stream.AsStream());
            Answers.Setup(a => a.RecentAsync(7, "dailyreport", Day, 5, It.IsAny<CancellationToken>()))
                .ReturnsAsync([new KnownAnswerPayload(Key, "Saved text.", J("""{"passed":true}"""), "luna")]);
            Answers.Setup(a => a.SaveAsync(7, "dailyreport", Day, It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>(),
                    It.IsAny<JsonElement>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .Callback<long, string, DateOnly, string, string?, string?, JsonElement, int, CancellationToken>(
                    (_, _, _, _, _, user, reply, keep, _) => Saved.Add((reply, keep, user)))
                .Returns(Task.CompletedTask);
        }

        private void Record(string path, object? body)
        {
            Paths.Add(path);
            Bodies.Add(JsonSerializer.SerializeToElement(body, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        }

        public DailyReportAgent Agent() =>
            new(Context.Object, Runtime.Object, Usage.Object, Answers.Object, NullLogger<DailyReportAgent>.Instance);
    }

    [Fact]
    public async Task A_brief_carries_the_dates_saved_answers_and_saves_its_new_answer()
    {
        var world = new World(Verified);
        var reply = await world.Agent().BriefAsync(7, "u1", new DailyBrief(Day, "day", null, null, Today), CancellationToken.None);

        reply.GetProperty("answer_key").GetString().Should().Be(Key);
        world.Paths.Should().Equal("agent/brief");
        var body = world.Bodies.Single();
        body.GetProperty("reportDate").GetString().Should().Be("2026-10-21");
        body.GetProperty("today").GetString().Should().Be("2026-10-22");
        body.GetProperty("scope").GetString().Should().Be("day");
        var known = body.GetProperty("knownAnswers").EnumerateArray().Single();
        known.GetProperty("key").GetString().Should().Be(Key);
        known.GetProperty("draft").GetString().Should().Be("Saved text.");
        world.Saved.Should().ContainSingle().Which.Keep.Should().Be(5);
        world.Saved[0].User.Should().Be("u1");
        world.Usage.Verify(u => u.AddAsync(It.Is<AiUsageLog>(l => l.Purpose == "dailyreport" && l.UserId == "u1"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task The_streamed_brief_passes_every_event_on_and_saves_the_result()
    {
        var world = new World(Verified,
            new AgentRuntimeEvent("stage", J("""{"stage":"writing"}""")),
            new AgentRuntimeEvent("delta", J("""{"text":"Well 101"}""")),
            new AgentRuntimeEvent("result", Verified));
        var seen = new List<string>();
        await foreach (var ev in world.Agent().BriefStreamAsync(7, "u1", new DailyBrief(Day, "day", null, null, Today), CancellationToken.None))
            seen.Add(ev.Type);

        seen.Should().Equal("stage", "delta", "result");
        world.Paths.Should().Equal("agent/brief/stream");
        world.Saved.Should().ContainSingle();
    }

    [Fact]
    public async Task A_question_carries_the_saved_answers_too()
    {
        var world = new World(Verified);
        await world.Agent().AskAsync(7, "u1", Day, "Which wells reported?", Today, CancellationToken.None);
        world.Paths.Should().Equal("agent/ask");
        world.Bodies[0].GetProperty("question").GetString().Should().Be("Which wells reported?");
        world.Bodies[0].GetProperty("knownAnswers").GetArrayLength().Should().Be(1);
    }

    [Fact]
    public void Only_a_verified_answer_with_a_well_formed_key_is_worth_saving()
    {
        AiFeatureAnswerStore.Answer(Verified)!.Key.Should().Be(Key);
        AiFeatureAnswerStore.Answer(Verified)!.Verification!.Value.GetProperty("passed").GetBoolean().Should().BeTrue();
        AiFeatureAnswerStore.Answer(J($$"""{"explanation":"x","verified":false,"answer_key":"{{Key}}"}""")).Should().BeNull();
        AiFeatureAnswerStore.Answer(J("""{"explanation":"x","verified":true,"answer_key":"not-a-hash"}""")).Should().BeNull();
        AiFeatureAnswerStore.Answer(J($$"""{"explanation":"","verified":true,"answer_key":"{{Key}}"}""")).Should().BeNull();
        AiFeatureAnswerStore.Answer(J("""{"explanation":"x","verified":true}""")).Should().BeNull();
    }

    [Fact]
    public void The_worker_prepares_today_in_the_users_time_zone_and_the_days_before()
    {
        // 21 Oct 21:00 UTC is already 22 Oct in Muscat (UTC+4).
        var now = new DateTime(2026, 10, 21, 21, 0, 0, DateTimeKind.Utc);
        DailyBriefWorker.Today("Asia/Muscat", now, out var known).Should().Be(new DateOnly(2026, 10, 22));
        known.Should().BeTrue();
        DailyBriefWorker.Today("Not/AZone", now, out known).Should().Be(new DateOnly(2026, 10, 21));
        known.Should().BeFalse();

        var briefs = DailyBriefWorker.DayBriefs(Today, 2);
        briefs.Select(b => b.ReportDate).Should().Equal(Today, Today.AddDays(-1));
        briefs.Should().OnlyContain(b => b.Scope == "day" && b.Today == Today && b.WellId == null);
        DailyBriefWorker.DayBriefs(Today, 0).Should().HaveCount(1);
    }

    [Fact]
    public void The_seed_offers_the_new_daily_report_settings_and_model_tiers()
    {
        var seed = AgenticFeatureCatalog.Get(AgenticFeatureCatalog.DailyReport);
        var values = AgenticFeatureSettingsRules.Resolve(seed, null).Values;
        values["prepareBriefs"].GetBoolean().Should().BeTrue();
        values["prepareEveryMinutes"].GetInt32().Should().Be(30);
        values["prepareDays"].GetInt32().Should().Be(2);
        values["prepareTimeZone"].GetString().Should().Be("Asia/Muscat");
        values["savedAnswersPerDate"].GetInt32().Should().Be(20);
        values["parallelWorkers"].GetInt32().Should().Be(4);
        // Small work on the fast model, writing on the main one.
        values["plannerTier"].GetString().Should().Be("fast");
        values["verifierTier"].GetString().Should().Be("fast");
        values["dayWriterTier"].GetString().Should().Be("main");
        values["writerTier"].GetString().Should().Be("main");
    }
}

internal static class AsyncEnumerableTestExtensions
{
    public static async IAsyncEnumerable<T> AsStream<T>(this IEnumerable<T> items)
    {
        foreach (var item in items)
        {
            await Task.Yield();
            yield return item;
        }
    }
}
