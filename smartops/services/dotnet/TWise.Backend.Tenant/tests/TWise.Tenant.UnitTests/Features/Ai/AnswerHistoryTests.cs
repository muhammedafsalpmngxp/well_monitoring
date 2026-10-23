using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Moq;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.Conversations;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>A reopened chat shows each answer's table, chart, findings, query and next questions (core.AiChatMessages.answer_json).</summary>
public sealed class AnswerHistoryTests
{
    private static AiQueryResult Rows(int count) =>
        new(["lift_type", "well_count"], Enumerable.Range(1, count).Select(i => new Dictionary<string, object?> { ["lift_type"] = $"T{i}", ["well_count"] = i }).ToList(), count, count, false);

    private static readonly AskDataChartDto Chart = new("bar", "Wells by lift type", ["PCP", "ESP"], [new AskDataChartSeriesDto("Wells", [337, 120])], "Lift type", "Wells");

    [Fact]
    public void Keeps_at_most_the_configured_rows_and_the_real_total()
    {
        var json = AiAnswerSnapshots.ToJson(new AiAnswerSnapshot(Rows(8), null, null, null, null), savedRows: 3);

        var back = AiAnswerSnapshots.FromJson(json)!;
        back.Result!.Rows.Should().HaveCount(3);
        back.Result.TotalRows.Should().Be(8);
        back.Result.Rows[0]["lift_type"]!.ToString().Should().Be("T1");
    }

    [Fact]
    public void Round_trips_the_chart_findings_query_and_follow_ups()
    {
        var json = AiAnswerSnapshots.ToJson(new AiAnswerSnapshot(Rows(2), Chart, ["PCP is 73.7% of the total."],
            new AskDataSqlDto("SELECT 1", true, 1), ["Show this by cluster"]), savedRows: 500);

        var back = AiAnswerSnapshots.FromJson(json)!;
        back.Chart!.Labels.Should().Equal("PCP", "ESP");
        back.Chart.Series[0].Data.Should().Equal(337, 120);
        back.Insights.Should().Equal("PCP is 73.7% of the total.");
        back.Sql!.Verified.Should().BeTrue();
        back.FollowUps.Should().Equal("Show this by cluster");
    }

    [Fact]
    public void An_answer_with_nothing_shown_stores_nothing()
    {
        AiAnswerSnapshots.ToJson(new AiAnswerSnapshot(null, null, [], null, []), savedRows: 500).Should().BeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("{not json")]
    public void Answers_saved_before_or_unreadable_have_no_snapshot(string? json)
    {
        AiAnswerSnapshots.FromJson(json).Should().BeNull();
    }

    [Fact]
    public async Task Reopening_a_chat_returns_each_answer_s_snapshot()
    {
        var conversations = new Mock<IAiConversationRepository>();
        conversations.Setup(c => c.GetAsync(3, 7, "1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new AiConversation { Id = 3, TenantId = 7, UserId = "1", SourceType = AiSources.AskData, SourceName = "Ask your data", Title = "Wells" });
        conversations.Setup(c => c.GetMessagesAsync(3, It.IsAny<CancellationToken>())).ReturnsAsync(
        [
            new AiChatMessage { Id = 8, Role = "user", Content = "How many wells by lift type?" },
            new AiChatMessage { Id = 9, Role = "assistant", Content = "PCP leads.", AnswerJson = AiAnswerSnapshots.ToJson(new AiAnswerSnapshot(Rows(2), Chart, null, null, null), 500) },
            new AiChatMessage { Id = 10, Role = "assistant", Content = "An older answer." },
        ]);

        var detail = await new GetAiConversationHandler(conversations.Object).Handle(new GetAiConversationQuery(7, 1, 3), default);

        detail!.Messages[1].Answer!.Result!.Rows.Should().HaveCount(2);
        detail.Messages[1].Answer!.Chart!.Type.Should().Be("bar");
        detail.Messages[2].Answer.Should().BeNull();
    }

    [Fact]
    public void The_saved_rows_setting_has_no_default()
    {
        var empty = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var act = () => AiHistoryOptions.From(empty);
        act.Should().Throw<Exception>().WithMessage("*AiHistory:SavedRows*");

        var set = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["AiHistory:SavedRows"] = "250" }).Build();
        AiHistoryOptions.From(set).SavedRows.Should().Be(250);
    }
}
