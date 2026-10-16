using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class MessageTokensTests
{
    private static readonly IReadOnlyDictionary<string, string> Values = MessageTokens.Values(
        "Weekly wells", "Wells report", new DateTime(2026, 9, 28, 3, 0, 0, DateTimeKind.Utc), "Asia/Muscat",
        "https://twise/reports/view/7", "Vishnu");

    [Fact]
    public void Every_token_is_replaced()
        => MessageTokens.Apply("{{name}}|{{item}}|{{run_date}}|{{run_time}}|{{link}}|{{owner}}", Values)
            .Should().Be("Weekly wells|Wells report|28 Sep 2026|07:00|https://twise/reports/view/7|Vishnu");

    [Fact]
    public void Unknown_tokens_stay_as_typed()
        => MessageTokens.Apply("Hi {{person}} and {{ name }}", Values).Should().Be("Hi {{person}} and {{ name }}");

    [Fact]
    public void Tokens_are_matched_exactly()
        => MessageTokens.Apply("{{Item}}", Values).Should().Be("{{Item}}");

    [Fact]
    public void Text_without_tokens_is_unchanged()
        => MessageTokens.Apply("Plain text {not a token}", Values).Should().Be("Plain text {not a token}");
}
