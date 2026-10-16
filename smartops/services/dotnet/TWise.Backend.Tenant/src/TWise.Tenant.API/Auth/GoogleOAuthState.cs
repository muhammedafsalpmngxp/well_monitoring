using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TWise.Tenant.API.Auth;

/// <summary>
/// Signed, expiring state for the Google OAuth round trip.
///
/// Google's callback arrives as a plain browser redirect, so it carries no JWT — the tenant,
/// user and target connection have to travel in the <c>state</c> parameter and come back
/// trustworthy. The payload is therefore HMAC-SHA256 signed with the app's JWT secret and
/// carries an expiry, so a tampered or replayed state is rejected rather than silently writing
/// a Google token onto another tenant's connection.
/// </summary>
public static class GoogleOAuthState
{
    /// <summary>A consent flow that takes longer than this has to be restarted.</summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    public static string Create(long connectionId, long userId, long tenantId, string signingKey)
    {
        var payload = new StatePayload(
            connectionId, userId, tenantId,
            Nonce: Convert.ToHexString(RandomNumberGenerator.GetBytes(8)),
            ExpiresAtUnix: DateTimeOffset.UtcNow.Add(Lifetime).ToUnixTimeSeconds());

        var json = JsonSerializer.Serialize(payload);
        var encoded = Base64UrlEncode(Encoding.UTF8.GetBytes(json));

        return $"{encoded}.{Sign(encoded, signingKey)}";
    }

    /// <summary>
    /// Verifies the signature and expiry. Returns null for anything untrustworthy — callers
    /// must treat null as "reject the callback", never as "carry on without the identity".
    /// </summary>
    public static StatePayload? Verify(string? state, string signingKey)
    {
        if (string.IsNullOrWhiteSpace(state)) return null;

        var parts = state.Split('.');
        if (parts.Length != 2) return null;

        var expected = Sign(parts[0], signingKey);

        // Fixed-time comparison — a byte-by-byte one leaks how much of a forged signature is right.
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(parts[1])))
            return null;

        try
        {
            var json = Encoding.UTF8.GetString(Base64UrlDecode(parts[0]));
            var payload = JsonSerializer.Deserialize<StatePayload>(json);

            if (payload is null) return null;
            if (DateTimeOffset.FromUnixTimeSeconds(payload.ExpiresAtUnix) < DateTimeOffset.UtcNow) return null;

            return payload;
        }
        catch (Exception ex) when (ex is JsonException or FormatException)
        {
            return null;
        }
    }

    private static string Sign(string encodedPayload, string signingKey)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(signingKey));
        return Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(encodedPayload)));
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        return Convert.FromBase64String(padded);
    }

    public sealed record StatePayload(long ConnectionId, long UserId, long TenantId, string Nonce, long ExpiresAtUnix);
}
