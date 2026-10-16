using System.Net;
using FluentAssertions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Ai;

public sealed class OpenAiCompatibleChatClientTests
{
    /// <summary>Answers with the queued responses in order and keeps the request bodies.</summary>
    private sealed class FakeHandler(params (HttpStatusCode Status, string Body)[] replies) : HttpMessageHandler
    {
        private int _next;
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Bodies.Add(await request.Content!.ReadAsStringAsync(ct));
            var (status, body) = replies[_next++];
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private const string Ok = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"hi\"}}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}";

    [Fact]
    public async Task ModelThatRejectsTemperature_IsRetriedWithoutIt_AndRemembered()
    {
        var provider = new AiProvider { Provider = "openai", BaseUrl = "https://example.test/v1", Model = "reasoning-" + Guid.NewGuid() };
        var handler = new FakeHandler(
            (HttpStatusCode.BadRequest, "{\"error\":{\"message\":\"Unsupported value: 'temperature' does not support 0.2\",\"param\":\"temperature\"}}"),
            (HttpStatusCode.OK, Ok), (HttpStatusCode.OK, Ok));
        var client = new OpenAiCompatibleChatClient(new HttpClient(handler));

        (await client.CompleteAsync(provider, "k", [new AiMessage("user", "x")], default)).Content.Should().Be("hi");
        await client.CompleteAsync(provider, "k", [new AiMessage("user", "x")], default);

        handler.Bodies[0].Should().Contain("temperature");
        handler.Bodies[1].Should().NotContain("temperature");
        handler.Bodies[2].Should().NotContain("temperature");   // remembered: no failed call first
    }

    [Fact]
    public async Task OtherBadRequest_IsReported_NotRetried()
    {
        var provider = new AiProvider { Provider = "openai", BaseUrl = "https://example.test/v1", Model = "m-" + Guid.NewGuid() };
        var handler = new FakeHandler((HttpStatusCode.BadRequest, "{\"error\":{\"message\":\"bad key\"}}"));
        var client = new OpenAiCompatibleChatClient(new HttpClient(handler));

        var act = () => client.CompleteAsync(provider, "k", [new AiMessage("user", "x")], default);
        (await act.Should().ThrowAsync<HttpRequestException>()).Which.Message.Should().Contain("bad key");
        handler.Bodies.Should().HaveCount(1);
    }
}
