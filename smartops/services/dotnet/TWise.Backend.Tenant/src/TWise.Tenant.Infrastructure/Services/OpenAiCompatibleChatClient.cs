using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Talks to any endpoint that implements POST {baseUrl}/chat/completions in the OpenAI shape:
/// OpenAI, Azure OpenAI (deployment URL), Anthropic (via its OpenAI-compatible route), DeepSeek,
/// Ollama, LM Studio, vLLM. One transport keeps the provider list a config choice, not a code path.
/// Reasoning models (e.g. gpt-5.x) accept only the default temperature: a 400 that names temperature is retried
/// once without it, and the model is remembered so later calls skip it (as the twise agents' provider does).
/// </summary>
public sealed class OpenAiCompatibleChatClient(HttpClient http) : IAiChatClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private const double Temperature = 0.2;
    /// <summary>Models (per endpoint) that rejected a temperature: sent without one from then on.</summary>
    private static readonly ConcurrentDictionary<string, bool> NoTemperature = new();

    public async Task<AiCompletion> CompleteAsync(AiProvider provider, string? apiKey, IReadOnlyList<AiMessage> messages, CancellationToken ct)
    {
        var res = await SendAsync(provider, apiKey, messages, stream: false, ct);
        using var _ = res;
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"The AI provider returned {(int)res.StatusCode}: {Trim(body)}");

        var parsed = JsonSerializer.Deserialize<ChatResponse>(body, Json);
        var content = parsed?.Choices?.FirstOrDefault()?.Message?.Content;
        if (content is null) throw new HttpRequestException("The AI provider returned no message: " + Trim(body));
        return new AiCompletion(content, parsed!.Usage?.PromptTokens ?? 0, parsed.Usage?.CompletionTokens ?? 0);
    }

    public async IAsyncEnumerable<string> StreamAsync(AiProvider provider, string? apiKey, IReadOnlyList<AiMessage> messages, [EnumeratorCancellation] CancellationToken ct)
    {
        using var res = await SendAsync(provider, apiKey, messages, stream: true, ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"The AI provider returned {(int)res.StatusCode}: {Trim(await res.Content.ReadAsStringAsync(ct))}");

        // OpenAI SSE: lines "data: {json}" and a final "data: [DONE]".
        using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(ct));
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (!line.StartsWith("data: ", StringComparison.Ordinal)) continue;
            var payload = line[6..];
            if (payload == "[DONE]") yield break;
            var delta = JsonSerializer.Deserialize<StreamChunk>(payload, Json)?.Choices?.FirstOrDefault()?.Delta?.Content;
            if (!string.IsNullOrEmpty(delta)) yield return delta;
        }
    }

    /// <summary>Sends the request; a 400 about temperature is retried once without it.</summary>
    private async Task<HttpResponseMessage> SendAsync(AiProvider provider, string? apiKey, IReadOnlyList<AiMessage> messages, bool stream, CancellationToken ct)
    {
        var key = provider.BaseUrl + "|" + provider.Model;
        var temperature = NoTemperature.ContainsKey(key) ? (double?)null : Temperature;
        var completion = stream ? HttpCompletionOption.ResponseHeadersRead : HttpCompletionOption.ResponseContentRead;
        using (var req = Build(provider, apiKey, messages, stream, temperature))
        {
            var res = await http.SendAsync(req, completion, ct);
            if (temperature is null || (int)res.StatusCode != 400) return res;
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!body.Contains("temperature", StringComparison.OrdinalIgnoreCase))
            {
                // Hand the caller a response it can still read.
                var copy = new HttpResponseMessage(res.StatusCode) { Content = new StringContent(body) };
                res.Dispose();
                return copy;
            }
            res.Dispose();
            NoTemperature[key] = true;
        }
        using var retry = Build(provider, apiKey, messages, stream, null);
        return await http.SendAsync(retry, completion, ct);
    }

    private static HttpRequestMessage Build(AiProvider provider, string? apiKey, IReadOnlyList<AiMessage> messages, bool stream, double? temperature)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, provider.BaseUrl.TrimEnd('/') + "/chat/completions");
        if (!string.IsNullOrEmpty(apiKey))
        {
            // Azure expects the key in its own header; everyone else uses Bearer.
            if (provider.Provider == "azure") req.Headers.Add("api-key", apiKey);
            else req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        }
        req.Content = JsonContent.Create(new ChatRequest(provider.Model, messages.Select(m => new ChatMessage(m.Role, m.Content)).ToList(), temperature, stream), options: Json);
        return req;
    }

    private static string Trim(string body) => body.Length <= 300 ? body : body[..300] + "…";

    private sealed record ChatRequest(string Model, List<ChatMessage> Messages, double? Temperature, bool Stream);
    private sealed record ChatMessage(string Role, string Content);
    private sealed record ChatResponse(List<Choice>? Choices, Usage? Usage);
    private sealed record Choice(ChatMessage? Message);
    private sealed record StreamChunk(List<StreamChoice>? Choices);
    private sealed record StreamChoice(StreamDelta? Delta);
    private sealed record StreamDelta(string? Content);
    private sealed record Usage([property: JsonPropertyName("prompt_tokens")] int PromptTokens, [property: JsonPropertyName("completion_tokens")] int CompletionTokens);
}
