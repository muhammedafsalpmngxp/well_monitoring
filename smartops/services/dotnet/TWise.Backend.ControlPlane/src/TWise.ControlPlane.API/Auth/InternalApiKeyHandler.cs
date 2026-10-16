using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace TWise.Backend.ControlPlane.API.Auth;

public sealed class InternalApiKeyHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IConfiguration configuration)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "InternalApiKey";
    public const string PolicyName = "InternalService";
    private const string ApiKeyHeader = "X-Api-Key";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(ApiKeyHeader, out var extractedKey))
            return Task.FromResult(AuthenticateResult.Fail("Missing X-Api-Key header."));

        var configuredKey = configuration["InternalApi:ApiKey"];
        if (string.IsNullOrEmpty(configuredKey))
            return Task.FromResult(AuthenticateResult.Fail("Internal API key not configured."));

        var extractedBytes = Encoding.UTF8.GetBytes(extractedKey!);
        var configuredBytes = Encoding.UTF8.GetBytes(configuredKey);
        if (!CryptographicOperations.FixedTimeEquals(extractedBytes, configuredBytes))
            return Task.FromResult(AuthenticateResult.Fail("Invalid API key."));

        var claims = new[]
        {
            new Claim(ClaimTypes.Name, "internal-service"),
            new Claim(ClaimTypes.Role, "internal")
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
