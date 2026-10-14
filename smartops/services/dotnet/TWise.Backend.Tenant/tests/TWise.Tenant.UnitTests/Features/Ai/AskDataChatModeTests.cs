using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>The Ask your data chatbot answers in the mode chosen in AI Settings → Ask Data & Features; agents are not affected.</summary>
public class AskDataChatModeTests
{
    private sealed class Capture : HttpMessageHandler
    {
        public string? Body;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("event: done\ndata: {}\n\n", Encoding.UTF8, "text/event-stream") };
        }
    }

    private static readonly AskDataCatalogDto Catalog = new("AlTasnimBI", [new AskDataCatalogSchemaDto("well", [new AskDataCatalogTableDto("w", ["id"])])]);

    private static SaveAskDataSettingsRequest Request(string? mode) => new(["well"], [], [], 500, 60, 3, 2, 1, 3, null, null, mode);

    private static async Task<JsonElement> SentByChatbot(string mode)
    {
        var capture = new Capture();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:AlTasnimBI"] = "Server=db,1433;Database=AlTasnimBI;User ID=u;Password=p;TrustServerCertificate=True;",
        }).Build();
        var client = new AgentRuntimeClient(new HttpClient(capture) { BaseAddress = new Uri("http://runtime/") }, config);
        var askData = AskDataSettingsRules.ToRuntime(new AiSettings { AskDataAllowedSchemas = "[\"well\"]", AskDataChatMode = mode });
        await foreach (var _ in client.AskDataAsync("q", [], new AgentRuntimeLlm("openai", "http://x", "m", "k", null), new Dictionary<string, string>(), askData, default)) { }
        return JsonDocument.Parse(capture.Body!).RootElement;
    }

    [Theory]
    [InlineData("deep", "deep")]
    [InlineData("normal", "normal")]
    [InlineData("NORMAL", "normal")]
    [InlineData("", "deep")]
    [InlineData("other", "deep")]
    public async Task The_chatbot_request_uses_the_tenants_mode(string stored, string sent)
    {
        var body = await SentByChatbot(stored);
        body.GetProperty("mode").GetString().Should().Be(sent);
        // The mode travels as the request's mode only, not inside the settings an agent run also receives.
        body.GetProperty("askDataSettings").TryGetProperty("chatMode", out _).Should().BeFalse();
    }

    [Fact]
    public void Agent_runs_never_carry_the_chatbot_mode()
    {
        var json = JsonSerializer.Serialize(AskDataSettingsRules.ToRuntime(new AiSettings { AskDataAllowedSchemas = "[\"well\"]", AskDataChatMode = "normal" }),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        json.Should().NotContain("chatMode").And.Contain("allowedSchemas");
    }

    [Fact]
    public void No_settings_row_means_deep_the_chatbots_default()
    {
        AskDataSettingsRules.ToDto(null).ChatMode.Should().Be("deep");
        AskDataSettingsRules.ToRuntime(null).ChatMode.Should().Be("deep");
    }

    [Theory]
    [InlineData(null, "deep")]       // an older client that does not send it
    [InlineData(" Normal ", "normal")]
    [InlineData("deep", "deep")]
    public void A_save_stores_the_mode(string? mode, string stored)
    {
        var s = new AiSettings();
        AskDataSettingsRules.Apply(s, Request(mode), Catalog);
        s.AskDataChatMode.Should().Be(stored);
        AskDataSettingsRules.ToDto(s).ChatMode.Should().Be(stored);
    }

    [Fact]
    public void An_unknown_mode_is_refused()
    {
        var act = () => AskDataSettingsRules.Apply(new AiSettings(), Request("fast"), Catalog);
        act.Should().Throw<InvalidOperationException>().WithMessage("*deep or normal*");
    }
}
