using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace TWise.Tenant.API.Auth;

/// <summary>
/// Dev-only authentication handler that creates a ClaimsPrincipal from
/// X-User-Id and X-User-Role headers. Registered only in Development.
/// </summary>
public class DevHeaderAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "DevHeaders";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // If a real JWT Bearer token is present (not just "bearer"), forward to JWT handler
        var authHeader = Request.Headers.Authorization.FirstOrDefault();
        if (!string.IsNullOrEmpty(authHeader)
            && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var token = authHeader["Bearer ".Length..].Trim();
            if (!string.IsNullOrEmpty(token) && token != "bearer")
            {
                // Delegate to the JWT scheme
                return await Context.AuthenticateAsync(
                    Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme);
            }
        }

        var userId = Request.Headers["X-User-Id"].FirstOrDefault();
        var userRole = Request.Headers["X-User-Role"].FirstOrDefault();
        var tenantId = Request.Headers["X-Tenant-Id"].FirstOrDefault();

        if (string.IsNullOrEmpty(userId) && string.IsNullOrEmpty(userRole))
            return AuthenticateResult.NoResult();

        // Allow auth with just X-User-Role (userId falls back to "system" in CurrentUserService)
        userId ??= "dev-user";
        tenantId ??= "2";

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
            new("tenantId", tenantId),
        };

        if (!string.IsNullOrEmpty(userRole))
        {
            // Support comma-separated roles: "Admin,Planner"
            foreach (var role in userRole.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                claims.Add(new Claim(ClaimTypes.Role, role));
            }
        }

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);

        return AuthenticateResult.Success(ticket);
    }
}
