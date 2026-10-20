using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// HTTP client for the Python agent runtime. Base address and key come from AgentRuntime:BaseUrl and
/// AgentRuntime:ApiKey (see DependencyInjection). Runs are read as server-sent events. Ask Data queries the
/// database in AgentRuntime:AskDataConnection, else ConnectionStrings:AlTasnimBI; it is sent with each run
/// that uses Ask Data, so the runtime keeps no database credentials of its own. The Agentic Features read the same
/// database: each request carries it with the feature's envelope (AI provider, prompts, settings, access, queries).
/// </summary>
public sealed partial class AgentRuntimeClient(HttpClient http, IConfiguration config) : IAgentRuntimeClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>A long feature operation sends "ping" every 15 seconds while it works; this long without a line means
    /// the runtime is gone.</summary>
    internal static TimeSpan FeatureStreamIdle { get; set; } = TimeSpan.FromMinutes(3);

    public async Task<AgentToolsDto> ListToolsAsync(CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(20));
        using var res = await http.GetAsync("api/agent-runtime/tools", cts.Token);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode}: {Trim(await res.Content.ReadAsStringAsync(cts.Token))}");
        var body = await res.Content.ReadFromJsonAsync<ToolsResponse>(Json, cts.Token);
        return new AgentToolsDto(body?.Tools ?? [], body?.Message);
    }

    public async IAsyncEnumerable<AgentRuntimeEvent> RunAsync(SaveAiAgentRequest agent, IReadOnlyDictionary<string, string> inputs,
        AgentRuntimeLlm? llm, string sessionId, IReadOnlyDictionary<string, string> prompts, AgentRuntimeAskData askData,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // Ask Data and Saved SQL steps read the Ask Data database (its login), under the tenant's Ask Data settings.
        var usesDatabase = AgentMapping.UsesDatabase(agent);
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/agent-runtime/run")
        {
            Content = JsonContent.Create(new
            {
                agent, inputs, llm, sessionId, db = usesDatabase ? AskDataDb() : null, prompts,
                askDataSettings = usesDatabase ? askData : null,
            }, options: Json),
        };
        await foreach (var ev in EventsAsync(req, ct)) yield return ev;
    }

    public async IAsyncEnumerable<AgentRuntimeEvent> AskDataAsync(string question, IReadOnlyList<Dictionary<string, string>> history,
        AgentRuntimeLlm llm, IReadOnlyDictionary<string, string> prompts, AgentRuntimeAskData askData,
        [EnumeratorCancellation] CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/agent-runtime/askdata/ask")
        {
            // The chatbot's mode is the tenant's choice (Settings → AI Settings); agents choose theirs per step.
            Content = JsonContent.Create(new
            {
                question, history, mode = AskDataSettingsRules.ChatMode(askData.ChatMode), db = AskDataDb(), llm, prompts,
                askDataSettings = askData,
            }, options: Json),
        };
        await foreach (var ev in EventsAsync(req, ct)) yield return ev;
    }

    /// <summary>Sends the request and reads the reply as server-sent events.</summary>
    private async IAsyncEnumerable<AgentRuntimeEvent> EventsAsync(HttpRequestMessage req, [EnumeratorCancellation] CancellationToken ct)
    {
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode}: {Trim(await res.Content.ReadAsStringAsync(ct))}");

        using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(ct));
        string type = "message", data = "";
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (line.Length == 0)
            {
                if (data.Length > 0) yield return new AgentRuntimeEvent(type, JsonSerializer.Deserialize<JsonElement>(data));
                (type, data) = ("message", "");
            }
            else if (line.StartsWith("event:", StringComparison.Ordinal)) type = line[6..].Trim();
            else if (line.StartsWith("data:", StringComparison.Ordinal)) data += line[5..].TrimStart();
        }
    }

    public async Task<JsonElement> ExportAgentFlowAsync(SaveAiAgentRequest agent, AgentFlowLlm? llm, CancellationToken ct)
    {
        // The agent's own fields plus "llm" (provider and model only): agentflow.json names the model it runs on.
        var body = JsonSerializer.SerializeToNode(agent, Json)!.AsObject();
        if (llm is not null) body["llm"] = JsonSerializer.SerializeToNode(llm, Json);
        using var res = await http.PostAsJsonAsync("api/agent-runtime/agentflow/export", body, Json, ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode}: {Trim(await res.Content.ReadAsStringAsync(ct))}");
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
    }

    public async Task<AgentFlowImportDto> ImportAgentFlowAsync(JsonElement flow, CancellationToken ct)
    {
        using var res = await http.PostAsJsonAsync("api/agent-runtime/agentflow/import", flow, Json, ct);
        if ((int)res.StatusCode == 400)
        {
            var detail = await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
            throw new InvalidOperationException(detail.TryGetProperty("detail", out var d) ? d.GetString() : "The file could not be imported.");
        }
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode}: {Trim(await res.Content.ReadAsStringAsync(ct))}");
        return await res.Content.ReadFromJsonAsync<AgentFlowImportDto>(Json, ct)
            ?? throw new InvalidOperationException("The file could not be imported.");
    }

    public async Task<AskDataExportFile> ExportAskDataAsync(AskDataExportRequest request, AgentRuntimeAskData askData, CancellationToken ct)
    {
        using var res = await http.PostAsJsonAsync("api/agent-runtime/askdata/export", new
        {
            request.Token, request.Format, question = request.Question ?? "", answer = request.Answer ?? "", request.Verified,
            db = AskDataDb(), askData = request.AskData, askDataSettings = askData,
        }, Json, ct);
        if ((int)res.StatusCode is 400 or 501)
        {
            var detail = await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
            throw new InvalidOperationException(detail.TryGetProperty("detail", out var d) ? d.GetString() : "The data could not be exported.");
        }
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode}: {Trim(await res.Content.ReadAsStringAsync(ct))}");
        var name = res.Content.Headers.ContentDisposition?.FileNameStar ?? res.Content.Headers.ContentDisposition?.FileName?.Trim('"')
            ?? $"export.{request.Format}";
        return new AskDataExportFile(await res.Content.ReadAsByteArrayAsync(ct),
            res.Content.Headers.ContentType?.MediaType ?? "application/octet-stream", name);
    }

    // ── Agentic Features ────────────────────────────────────────────────────────────────────────────────────────

    public async Task<JsonElement> FeatureCallAsync(string feature, string path, AgenticFeatureEnvelope envelope, object? body,
        CancellationToken ct)
    {
        using var req = FeatureRequest(feature, path, envelope, body);
        using var res = await http.SendAsync(req, ct);
        await EnsureFeatureSuccessAsync(res, ct);
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
    }

    public async Task<AskDataExportFile> FeatureFileAsync(string feature, string path, AgenticFeatureEnvelope envelope, object? body,
        CancellationToken ct)
    {
        using var req = FeatureRequest(feature, path, envelope, body);
        using var res = await http.SendAsync(req, ct);
        await EnsureFeatureSuccessAsync(res, ct);
        var name = res.Content.Headers.ContentDisposition?.FileNameStar ?? res.Content.Headers.ContentDisposition?.FileName?.Trim('"')
            ?? $"{feature}-export";
        return new AskDataExportFile(await res.Content.ReadAsByteArrayAsync(ct),
            res.Content.Headers.ContentType?.MediaType ?? "application/octet-stream", name);
    }

    public async IAsyncEnumerable<AgentRuntimeEvent> FeatureStreamAsync(string feature, string path, AgenticFeatureEnvelope envelope,
        object? body, [EnumeratorCancellation] CancellationToken ct)
    {
        using var req = FeatureRequest(feature, path, envelope, body);
        // HttpClient.Timeout ends when the headers arrive (they come at once); the stream itself is bounded by ct and by
        // FeatureStreamIdle between lines.
        using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        await EnsureFeatureSuccessAsync(res, ct);

        using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(ct));
        string type = "message", data = "";
        while (await ReadLineAsync(reader, ct) is { } line)
        {
            if (line.Length == 0)
            {
                if (data.Length > 0) yield return new AgentRuntimeEvent(type, JsonSerializer.Deserialize<JsonElement>(data));
                (type, data) = ("message", "");
            }
            else if (line.StartsWith("event:", StringComparison.Ordinal)) type = line[6..].Trim();
            else if (line.StartsWith("data:", StringComparison.Ordinal)) data += line[5..].TrimStart();
        }
    }

    private static async Task<string?> ReadLineAsync(StreamReader reader, CancellationToken ct)
    {
        using var idle = CancellationTokenSource.CreateLinkedTokenSource(ct);
        idle.CancelAfter(FeatureStreamIdle);
        try { return await reader.ReadLineAsync(idle.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new AgentRuntimeException(504, "The agent service stopped responding. Try again.");
        }
    }

    /// <summary>POST api/agent-runtime/features/{feature}/{path}: the body's own fields, then the envelope (which wins:
    /// a body cannot name another database or provider).</summary>
    private HttpRequestMessage FeatureRequest(string feature, string path, AgenticFeatureEnvelope e, object? body)
    {
        if (!FeatureSegment().IsMatch(feature)) throw new ArgumentException($"'{feature}' is not a feature name.", nameof(feature));
        if (!FeaturePath().IsMatch(path)) throw new ArgumentException($"'{path}' is not a feature path.", nameof(path));
        var json = body is null ? new JsonObject()
            : JsonSerializer.SerializeToNode(body, Json) as JsonObject
              ?? throw new ArgumentException("A feature request body must be a JSON object.", nameof(body));
        json["db"] = JsonSerializer.SerializeToNode(AskDataDb(), Json);
        json["llm"] = e.Llm is null ? null : JsonSerializer.SerializeToNode(e.Llm, Json);
        json["prompts"] = JsonSerializer.SerializeToNode(e.Prompts, Json);
        json["settings"] = JsonSerializer.SerializeToNode(e.Settings, Json);
        json["access"] = JsonSerializer.SerializeToNode(e.Access, Json);
        json["queries"] = JsonSerializer.SerializeToNode(e.Queries, Json);
        return new HttpRequestMessage(HttpMethod.Post, $"api/agent-runtime/features/{feature}/{path}")
        {
            Content = JsonContent.Create(json, options: Json),
        };
    }

    /// <summary>A refusal the user can act on (bad input, a table the feature may not read, not found, the database or
    /// AI provider down) becomes AgentRuntimeException with the runtime's message; anything else HttpRequestException.</summary>
    private static async Task EnsureFeatureSuccessAsync(HttpResponseMessage res, CancellationToken ct)
    {
        if (res.IsSuccessStatusCode) return;
        var status = (int)res.StatusCode;
        var text = await res.Content.ReadAsStringAsync(ct);
        throw status switch
        {
            400 or 404 or 409 or 503 => new AgentRuntimeException(status, Detail(text) ?? "The agent service refused the request."),
            422 => new AgentRuntimeException(400, "The request is not valid: " + (Detail(text) ?? "check the values sent.")),
            401 or 403 => new HttpRequestException($"{status}: the agent service refused the Tenant API's key (AgentRuntime:ApiKey)."),
            _ => new HttpRequestException($"{status}: {Trim(text)}"),
        };
    }

    /// <summary>FastAPI's "detail": a message, {message}, or a validation error list (their "msg"s).</summary>
    internal static string? Detail(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("detail", out var d)) return null;
            return d.ValueKind switch
            {
                JsonValueKind.String => d.GetString(),
                JsonValueKind.Object when d.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String => m.GetString(),
                JsonValueKind.Array => string.Join("; ", d.EnumerateArray().Take(3).Select(ValidationMessage)),
                _ => null,
            };
        }
        catch (JsonException) { return null; }
    }

    private static string ValidationMessage(JsonElement x)
    {
        var msg = x.ValueKind == JsonValueKind.Object && x.TryGetProperty("msg", out var m) ? m.GetString() ?? "" : "";
        var loc = x.ValueKind == JsonValueKind.Object && x.TryGetProperty("loc", out var l) && l.ValueKind == JsonValueKind.Array
            ? string.Join('.', l.EnumerateArray().Skip(1).Select(p => p.ToString())) : "";
        return loc.Length > 0 ? $"{loc}: {msg}" : msg;
    }

    [GeneratedRegex("^[a-z][a-z0-9-]{0,40}$")]
    private static partial Regex FeatureSegment();

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{0,60}(/[A-Za-z0-9][A-Za-z0-9._-]{0,120}){0,4}$")]
    private static partial Regex FeaturePath();

    /// <summary>The Ask Data database as the runtime expects it (server, port, name, user, password).</summary>
    private object AskDataDb()
    {
        var b = new SqlConnectionStringBuilder(AskDataConnection(config));
        var (server, port) = b.DataSource.Split(',') is [var host, var p] && int.TryParse(p, out var n) ? (host, n) : (b.DataSource, 1433);
        return new
        {
            server = server.Replace("tcp:", "", StringComparison.OrdinalIgnoreCase), port, name = b.InitialCatalog,
            user = b.UserID, password = b.Password,
            encrypt = b.Encrypt == SqlConnectionEncryptOption.Optional ? "no" : "yes",
            trustCert = b.TrustServerCertificate ? "yes" : "no",
        };
    }

    /// <summary>The Ask Data database's connection string: AgentRuntime:AskDataConnection, else ConnectionStrings:AlTasnimBI.</summary>
    internal static string AskDataConnection(IConfiguration config) =>
        config["AgentRuntime:AskDataConnection"] is { Length: > 0 } c ? c : config.GetConnectionString("AlTasnimBI")
            ?? throw new InvalidOperationException("Ask Data has no database: set ConnectionStrings:AlTasnimBI or AgentRuntime:AskDataConnection.");

    private static string Trim(string s) => s.Length <= 300 ? s : s[..300] + "…";

    private sealed record ToolsResponse(List<AgentToolDto>? Tools, string? Message);
}
