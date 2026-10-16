using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.DataSources;

namespace TWise.Tenant.Infrastructure.DataSources.Connectors;

/// <summary>
/// Google OAuth 2.0 authorization-code flow, talking to Google's token endpoint directly.
///
/// Configuration (appsettings):
///   Google:ClientId, Google:ClientSecret, Google:RedirectUri
///
/// The redirect URI must match one registered on the OAuth client in the Google Cloud console
/// exactly, or Google rejects the exchange with redirect_uri_mismatch.
/// </summary>
public sealed class GoogleOAuthService(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    ILogger<GoogleOAuthService> logger) : IGoogleOAuthService
{
    public const string HttpClientName = "GoogleOAuth";

    private const string AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";

    private const string SheetsScope = "https://www.googleapis.com/auth/spreadsheets.readonly";
    private const string DriveScope = "https://www.googleapis.com/auth/drive.readonly";

    private string? ClientId => configuration["Google:ClientId"];
    private string? ClientSecret => configuration["Google:ClientSecret"];
    private string? RedirectUri => configuration["Google:RedirectUri"];

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret) &&
        !string.IsNullOrWhiteSpace(RedirectUri);

    public string BuildAuthorizationUrl(string state, bool includeDriveScope)
    {
        EnsureConfigured();

        var scopes = includeDriveScope ? $"{SheetsScope} {DriveScope}" : SheetsScope;

        var query = new Dictionary<string, string>
        {
            ["client_id"] = ClientId!,
            ["redirect_uri"] = RedirectUri!,
            ["response_type"] = "code",
            ["scope"] = scopes,
            // offline + consent are what actually produce a refresh token; without them Google
            // returns only an access token on a repeat authorisation and the source breaks in an hour.
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["include_granted_scopes"] = "true",
            ["state"] = state
        };

        var encoded = string.Join('&', query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return $"{AuthorizationEndpoint}?{encoded}";
    }

    public async Task<GoogleTokenResult> ExchangeCodeAsync(string code, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var response = await PostTokenRequestAsync(new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = ClientId!,
            ["client_secret"] = ClientSecret!,
            ["redirect_uri"] = RedirectUri!,
            ["grant_type"] = "authorization_code"
        }, cancellationToken);

        return new GoogleTokenResult(
            response.AccessToken,
            response.RefreshToken,
            DateTimeOffset.UtcNow.AddSeconds(response.ExpiresIn));
    }

    public async Task<string> GetAccessTokenAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        EnsureConfigured();

        var response = await PostTokenRequestAsync(new Dictionary<string, string>
        {
            ["refresh_token"] = refreshToken,
            ["client_id"] = ClientId!,
            ["client_secret"] = ClientSecret!,
            ["grant_type"] = "refresh_token"
        }, cancellationToken);

        return response.AccessToken;
    }

    private async Task<GoogleTokenResponse> PostTokenRequestAsync(
        Dictionary<string, string> form, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);

        using var content = new FormUrlEncodedContent(form);
        using var response = await client.PostAsync(TokenEndpoint, content, cancellationToken);

        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Google returns {"error":"…","error_description":"…"} — surface the description,
            // which is the part that tells you what to fix, and never log the form (it has the secret).
            var description = TryReadErrorDescription(body);
            logger.LogWarning("Google token request failed with {StatusCode}: {Error}", (int)response.StatusCode, description);
            throw new InvalidOperationException($"Google rejected the request: {description}");
        }

        var parsed = JsonSerializer.Deserialize<GoogleTokenResponse>(body);

        if (parsed is null || string.IsNullOrWhiteSpace(parsed.AccessToken))
            throw new InvalidOperationException("Google returned a token response without an access token.");

        return parsed;
    }

    private static string TryReadErrorDescription(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);

            if (doc.RootElement.TryGetProperty("error_description", out var description))
                return description.GetString() ?? "unknown error";

            if (doc.RootElement.TryGetProperty("error", out var error))
                return error.GetString() ?? "unknown error";
        }
        catch (JsonException)
        {
            // Non-JSON error body — fall through to the generic message.
        }

        return "unknown error";
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
            throw new InvalidOperationException(
                "Google integration is not configured. Set Google:ClientId, Google:ClientSecret and Google:RedirectUri.");
    }

    private sealed record GoogleTokenResponse
    {
        [System.Text.Json.Serialization.JsonPropertyName("access_token")]
        public string AccessToken { get; init; } = string.Empty;

        [System.Text.Json.Serialization.JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; init; }

        [System.Text.Json.Serialization.JsonPropertyName("expires_in")]
        public int ExpiresIn { get; init; }
    }
}
