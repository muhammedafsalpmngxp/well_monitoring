namespace TWise.Tenant.Application.Abstractions.DataSources;

/// <summary>
/// Google OAuth 2.0 authorization-code flow for Sheets and Drive data sources.
///
/// The tenant consents once in the browser; the resulting refresh token is encrypted into
/// DataSourceConnection.CredentialsEncrypted, and short-lived access tokens are minted from it
/// on each fetch. Access tokens are never persisted.
/// </summary>
public interface IGoogleOAuthService
{
    /// <summary>True when Google:ClientId and Google:ClientSecret are configured.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Build the Google consent URL to redirect the user to.
    /// <paramref name="state"/> is echoed back to the callback and must be verified there.
    /// </summary>
    string BuildAuthorizationUrl(string state, bool includeDriveScope);

    /// <summary>Exchange the authorization code from the callback for a refresh token.</summary>
    Task<GoogleTokenResult> ExchangeCodeAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>Mint a fresh access token from a stored refresh token.</summary>
    Task<string> GetAccessTokenAsync(string refreshToken, CancellationToken cancellationToken = default);
}

/// <param name="RefreshToken">Null when Google withheld one — usually a re-consent without prompt=consent.</param>
public sealed record GoogleTokenResult(string AccessToken, string? RefreshToken, DateTimeOffset ExpiresAt);
