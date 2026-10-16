using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Raw transport to an OpenAI-compatible chat endpoint. No quota, no logging: see IAiService.</summary>
public interface IAiChatClient
{
    Task<AiCompletion> CompleteAsync(AiProvider provider, string? apiKey, IReadOnlyList<AiMessage> messages, CancellationToken ct);

    /// <summary>Yields content deltas as the model produces them. Token usage is not reported by most providers in streaming mode.</summary>
    IAsyncEnumerable<string> StreamAsync(AiProvider provider, string? apiKey, IReadOnlyList<AiMessage> messages, CancellationToken ct);
}

/// <summary>
/// The one entry point every AI feature uses: loads the tenant's settings and active provider,
/// enforces the daily quota, calls the model and records a usage row. Throws
/// InvalidOperationException with a user-readable message when AI is off, unconfigured or over quota.
/// </summary>
public interface IAiService
{
    Task<AiCompletion> CompleteAsync(long tenantId, string? userId, string purpose, IReadOnlyList<AiMessage> messages, CancellationToken ct);

    /// <summary>Streaming variant with the same settings/quota/logging behaviour; the usage row is written when the stream ends.</summary>
    IAsyncEnumerable<string> StreamAsync(long tenantId, string? userId, string purpose, IReadOnlyList<AiMessage> messages, CancellationToken ct);

    /// <summary>
    /// The active provider and its decrypted key for a caller that makes the model call itself (the agent
    /// runtime). Same checks as a call here (AI enabled, a provider active, quota left); the caller logs usage.
    /// </summary>
    Task<(AiProvider Provider, string? ApiKey)> ResolveProviderAsync(long tenantId, CancellationToken ct);

    /// <summary>Sends a one-line prompt to a specific provider (active or not) so an admin can test it before switching. Logged and counted.</summary>
    Task<AiCompletion> TestProviderAsync(long tenantId, string? userId, AiProvider provider, CancellationToken ct);
}

/// <summary>Encrypts/decrypts the API key; declared here so Application handlers do not depend on Infrastructure.</summary>
public interface IAiKeyProtector
{
    string Protect(string apiKey);
    string Unprotect(string encrypted);
}
