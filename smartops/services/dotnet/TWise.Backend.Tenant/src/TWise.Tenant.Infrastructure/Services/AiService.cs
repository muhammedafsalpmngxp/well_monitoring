using System.Diagnostics;
using System.Runtime.CompilerServices;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>Settings + active provider + quota + usage log around IAiChatClient. Every AI feature goes through here.</summary>
public sealed class AiService(IAiSettingsRepository settings, IAiProviderRepository providers, IAiUsageRepository usage, IAiChatClient client, IAiKeyProtector keys) : IAiService
{
    public async Task<AiCompletion> CompleteAsync(long tenantId, string? userId, string purpose, IReadOnlyList<AiMessage> messages, CancellationToken ct)
    {
        var (p, apiKey, log) = await PrepareAsync(tenantId, userId, purpose, ct);
        return await RunAsync(p, apiKey, log, messages, ct);
    }

    public async IAsyncEnumerable<string> StreamAsync(long tenantId, string? userId, string purpose, IReadOnlyList<AiMessage> messages, [EnumeratorCancellation] CancellationToken ct)
    {
        var (p, apiKey, log) = await PrepareAsync(tenantId, userId, purpose, ct);
        var sw = Stopwatch.StartNew();
        try
        {
            await foreach (var delta in Guarded(client.StreamAsync(p, apiKey, messages, ct), log, ct))
                yield return delta;
            log.Succeeded = log.Error is null;
        }
        finally
        {
            log.LatencyMs = (int)sw.ElapsedMilliseconds;
            await usage.AddAsync(log, CancellationToken.None);
        }
    }

    public async Task<(AiProvider Provider, string? ApiKey)> ResolveProviderAsync(long tenantId, CancellationToken ct)
    {
        var (p, apiKey, _) = await PrepareAsync(tenantId, null, "agent", ct);
        return (p, apiKey);
    }

    /// <summary>The tested provider's quota still applies (a test is a real call) but the enabled flag and active choice do not.</summary>
    public async Task<AiCompletion> TestProviderAsync(long tenantId, string? userId, AiProvider provider, CancellationToken ct)
    {
        await CheckQuotaAsync(tenantId, provider, ct);
        var log = new AiUsageLog { TenantId = tenantId, UserId = userId, Purpose = "test", Model = provider.Model };
        return await RunAsync(provider, Key(provider), log, [new AiMessage("user", "Reply with the single word OK.")], ct);
    }

    private async Task<AiCompletion> RunAsync(AiProvider p, string? apiKey, AiUsageLog log, IReadOnlyList<AiMessage> messages, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var result = await client.CompleteAsync(p, apiKey, messages, ct);
            log.PromptTokens = result.PromptTokens;
            log.CompletionTokens = result.CompletionTokens;
            log.Succeeded = true;
            return result;
        }
        catch (Exception ex)
        {
            log.Error = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
            throw;
        }
        finally
        {
            log.LatencyMs = (int)sw.ElapsedMilliseconds;
            // Log with a fresh token: the caller's may already be cancelled and the row must still land.
            await usage.AddAsync(log, CancellationToken.None);
        }
    }

    /// <summary>Records a provider error on the log without swallowing it (C# forbids yield inside try/catch).</summary>
    private static async IAsyncEnumerable<string> Guarded(IAsyncEnumerable<string> source, AiUsageLog log, [EnumeratorCancellation] CancellationToken ct)
    {
        await using var e = source.GetAsyncEnumerator(ct);
        while (true)
        {
            string? error = null;
            var more = false;
            try { more = await e.MoveNextAsync(); }
            catch (Exception ex) { error = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message; log.Error = error; }
            if (error is not null) throw new HttpRequestException(error);
            if (!more) yield break;
            yield return e.Current;
        }
    }

    private async Task<(AiProvider, string?, AiUsageLog)> PrepareAsync(long tenantId, string? userId, string purpose, CancellationToken ct)
    {
        var s = await settings.GetAsync(tenantId, ct);
        if (s is null || !s.IsEnabled) throw new InvalidOperationException("AI is turned off for this tenant. An admin can enable it under Settings → AI.");
        var p = await providers.GetActiveAsync(tenantId, ct)
            ?? throw new InvalidOperationException("No AI provider is active. An admin can add one under Settings → AI.");
        await CheckQuotaAsync(tenantId, p, ct);
        return (p, Key(p), new AiUsageLog { TenantId = tenantId, UserId = userId, Purpose = purpose, Model = p.Model });
    }

    /// <summary>The limit is the provider's; the count is every AI call the tenant made today (so switching provider
    /// changes the limit, not the count).</summary>
    private async Task CheckQuotaAsync(long tenantId, AiProvider p, CancellationToken ct)
    {
        if (p.DailyQuota > 0 && await usage.CountTodayAsync(tenantId, ct) >= p.DailyQuota)
            throw new InvalidOperationException($"The daily AI quota of {p.DailyQuota} calls has been reached. It resets at midnight UTC.");
    }

    private string? Key(AiProvider p) => string.IsNullOrEmpty(p.ApiKeyEncrypted) ? null : keys.Unprotect(p.ApiKeyEncrypted);
}

/// <summary>Reuses the connection-password cipher so there is one encryption key to manage.</summary>
public sealed class AiKeyProtector : IAiKeyProtector
{
    public string Protect(string apiKey) => ConnectionPasswordHelper.Encrypt(apiKey);
    public string Unprotect(string encrypted) => ConnectionPasswordHelper.Decrypt(encrypted);
}
