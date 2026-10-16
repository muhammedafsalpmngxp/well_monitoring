using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Identity.Web;

namespace SmartOps.Shared.Auth;

public static class AuthExtensions
{
    /// <summary>
    /// Configures dual-mode authentication:
    ///  • Azure Entra ID (when AzureAd:TenantId is present) — preferred for SSO
    ///  • Local JWT — fallback for dev or services without Entra
    /// </summary>
    public static IServiceCollection AddSmartOpsAuth(this IServiceCollection services,
                                                     IConfiguration config)
    {
        services.Configure<JwtSettings>(config.GetSection("JwtSettings"));
        services.AddSingleton<IJwtTokenService, JwtTokenService>();

        var jwt = config.GetSection("JwtSettings").Get<JwtSettings>() ?? new JwtSettings();
        // A copy of the repo without real settings carries a CHANGE_ME placeholder: tokens signed with a key anyone
        // can read in the repo would be forgeable, so refuse to start.
        if (jwt.SecretKey.StartsWith("CHANGE_ME", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "JwtSettings:SecretKey is still the CHANGE_ME placeholder. Set the real value " +
                "(environment variable JwtSettings__SecretKey), the same one every TWise API uses.");
        var tenantId = config["AzureAd:TenantId"];
        var useEntra = !string.IsNullOrWhiteSpace(tenantId);

        var auth = services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme);

        if (useEntra)
        {
            auth.AddMicrosoftIdentityWebApi(config, "AzureAd");
        }
        else
        {
            auth.AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwt.Issuer,
                    ValidAudience = jwt.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(
                        Encoding.UTF8.GetBytes(jwt.SecretKey))
                };
                options.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async context =>
                    {
                        var tokenTypes = context.Principal?.FindAll("token_type").ToArray();
                        if (tokenTypes is not { Length: 1 } || tokenTypes[0].Value != "access")
                        {
                            context.Fail("An access token is required.");
                            return;
                        }

                        var validator = context.HttpContext.RequestServices?.GetService<IAccessTokenValidator>();
                        if (validator is not null && !await validator.ValidateAsync(context.Principal!, context.HttpContext.RequestAborted))
                            context.Fail("Your session has ended. Please sign in again.");
                    }
                };
            });
        }

        services.AddAuthorization(options =>
        {
            options.AddPolicy("Admin", p => p.RequireRole("admin"));
            options.AddPolicy("Manager", p => p.RequireRole("admin", "manager"));
            options.AddPolicy("Viewer", p => p.RequireRole("admin", "manager", "viewer"));
        });

        return services;
    }
}
