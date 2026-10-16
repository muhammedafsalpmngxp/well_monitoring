using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using SmartOps.Shared.Auth;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.API.Extensions;
using TWise.Backend.ControlPlane.Infrastructure.Services;
using Xunit;
using Xunit.Abstractions;

namespace TWise.Backend.ControlPlane.UnitTests.Features.Auth;

public sealed class AuthSecurityTests : IDisposable
{
    private readonly JwtSettings _settings = new()
    {
        SecretKey = "test-only-signing-key-not-used-by-any-running-service-20260910",
        Issuer = "login-audit",
        Audience = "login-audit-api"
    };
    private readonly ServiceProvider _provider;
    private readonly IJwtTokenService _tokens;
    private readonly TokenValidationParameters _bearerValidation;
    private readonly ITestOutputHelper _output;

    public AuthSecurityTests(ITestOutputHelper output)
    {
        _output = output;
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["JwtSettings:SecretKey"] = _settings.SecretKey,
            ["JwtSettings:Issuer"] = _settings.Issuer,
            ["JwtSettings:Audience"] = _settings.Audience
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSmartOpsAuth(configuration);
        _provider = services.BuildServiceProvider();
        _tokens = _provider.GetRequiredService<IJwtTokenService>();
        _bearerValidation = _provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme).TokenValidationParameters;
    }

    public void Dispose() => _provider.Dispose();

    private string IssueBackdatedToken(double hoursAgo, double lifetimeHours, bool refresh,
        string? signingKey = null, string? issuer = null, string? audience = null)
    {
        var issued = DateTime.UtcNow.AddHours(-hoursAgo);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, "42"),
            new(JwtRegisteredClaimNames.Iat, EpochTime.GetIntDate(issued).ToString(), ClaimValueTypes.Integer64)
        };
        if (refresh) claims.Add(new Claim("token_type", "refresh"));
        else claims.Add(new Claim(ClaimTypes.Role, "viewer"));
        var token = new JwtSecurityToken(
            issuer: issuer ?? _settings.Issuer,
            audience: audience ?? _settings.Audience,
            claims: claims,
            notBefore: issued,
            expires: issued.AddHours(lifetimeHours),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey ?? _settings.SecretKey)),
                SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    [Fact]
    public void IssuedTokens_HaveEightHourAndSevenDayLifetimes()
    {
        var handler = new JwtSecurityTokenHandler();
        var access = handler.ReadJwtToken(_tokens.Issue("42", "audit@example.invalid", "viewer", "Audit", 7));
        var refresh = handler.ReadJwtToken(_tokens.IssueRefreshToken("42"));
        (access.ValidTo - access.IssuedAt).Should().Be(TimeSpan.FromHours(8));
        (refresh.ValidTo - refresh.IssuedAt).Should().Be(TimeSpan.FromDays(7));
    }

    [Fact]
    public void SessionTokens_PreserveSessionIdAcrossAccessAndRefreshPairs()
    {
        var sessionId = Guid.NewGuid().ToString();
        var handler = new JwtSecurityTokenHandler();
        var access = _tokens.Issue(new JwtAccessTokenRequest
        {
            Subject = "42",
            Email = "audit@example.invalid",
            Role = "viewer",
            FullName = "Audit",
            TenantId = 7,
            SecurityStamp = "stamp",
            SessionId = sessionId
        });
        var refresh = _tokens.IssueRefreshToken("42", "stamp", sessionId);
        var renewedRefresh = _tokens.IssueRefreshToken("42", "stamp", sessionId);

        handler.ReadJwtToken(access).Claims.Single(claim => claim.Type == "sid").Value.Should().Be(sessionId);
        handler.ReadJwtToken(refresh).Claims.Single(claim => claim.Type == "sid").Value.Should().Be(sessionId);
        handler.ReadJwtToken(renewedRefresh).Claims.Single(claim => claim.Type == "sid").Value.Should().Be(sessionId);
        renewedRefresh.Should().NotBe(refresh);
        _tokens.ValidateRefreshToken(refresh, "stamp").Should().Be("42");
    }

    [Fact]
    public void AfterTenHours_AccessIsExpiredButRefreshRemainsValid()
    {
        var access = IssueBackdatedToken(10, 8, false);
        var refresh = IssueBackdatedToken(10, 168, true);
        var validateAccess = () => new JwtSecurityTokenHandler().ValidateToken(access, _bearerValidation, out _);
        validateAccess.Should().Throw<SecurityTokenExpiredException>();
        _tokens.ValidateRefreshToken(refresh).Should().Be("42");
    }

    [Theory]
    [InlineData(10, true)]
    [InlineData(167, true)]
    [InlineData(169, false)]
    public void RefreshLifetime_IsEnforcedAfterIdle(int idleHours, bool expectedValid)
    {
        var refresh = IssueBackdatedToken(idleHours, 168, true);
        (_tokens.ValidateRefreshToken(refresh) is not null).Should().Be(expectedValid);
    }

    [Fact]
    public void RefreshExpiredBeyondClockTolerance_IsRejected()
    {
        var refresh = IssueBackdatedToken(168 + 60.0 / 3600, 168, true);
        _tokens.ValidateRefreshToken(refresh).Should().BeNull();
    }

    [Fact]
    public void Refresh_RejectsWrongSignatureIssuerAudienceAndAccessToken()
    {
        var invalidTokens = new[]
        {
            IssueBackdatedToken(10, 168, true, signingKey: "different-test-only-signing-key-at-least-thirty-two-bytes"),
            IssueBackdatedToken(10, 168, true, issuer: "wrong-issuer"),
            IssueBackdatedToken(10, 168, true, audience: "wrong-audience"),
            _tokens.Issue("42", "audit@example.invalid", "viewer", "Audit"),
            "not.a.jwt",
            string.Empty
        };
        foreach (var token in invalidTokens) _tokens.ValidateRefreshToken(token).Should().BeNull();
    }

    [Fact]
    public void RiskCharacterization_RefreshTokenCanBeReused()
    {
        var original = _tokens.IssueRefreshToken("42");
        _tokens.ValidateRefreshToken(original).Should().Be("42");
        _tokens.IssueRefreshToken("42").Should().NotBe(original);
        _tokens.ValidateRefreshToken(original).Should().Be("42");
    }

    [Fact]
    public async Task BearerAuthentication_RejectsRefreshAndLegacyTokensButAcceptsAccessTokens()
    {
        var options = _provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);
        var cases = new[]
        {
            (Token: _tokens.IssueRefreshToken("42"), Allowed: false),
            (Token: IssueBackdatedToken(1, 8, false), Allowed: false),
            (Token: _tokens.Issue("42", "audit@example.invalid", "viewer", "Audit"), Allowed: true)
        };
        foreach (var testCase in cases)
        {
            var principal = new JwtSecurityTokenHandler().ValidateToken(testCase.Token, _bearerValidation, out var token);
            var context = new TokenValidatedContext(new DefaultHttpContext(),
                new AuthenticationScheme(JwtBearerDefaults.AuthenticationScheme, null, typeof(JwtBearerHandler)), options)
            {
                Principal = principal,
                SecurityToken = token
            };
            await options.Events.TokenValidated(context);
            (context.Result?.Failure is null).Should().Be(testCase.Allowed);
        }
    }

    [Theory]
    [InlineData("admin", "Admin", true)]
    [InlineData("viewer", "Admin", false)]
    [InlineData("operator", "Admin", false)]
    [InlineData("viewer", "Viewer", true)]
    public async Task SharedRolePolicies_EnforceRoleClaims(string role, string policy, bool expectedAllowed)
    {
        var token = _tokens.Issue("42", "audit@example.invalid", role, "Audit", 7);
        var principal = new JwtSecurityTokenHandler().ValidateToken(token, _bearerValidation, out _);
        var result = await _provider.GetRequiredService<IAuthorizationService>()
            .AuthorizeAsync(principal, null, policy);
        result.Succeeded.Should().Be(expectedAllowed);
    }

    [Fact]
    public async Task HttpPipeline_EnforcesBearerPurposeFallbackAndControllerAdminPolicies()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["JwtSettings:SecretKey"] = _settings.SecretKey,
            ["JwtSettings:Issuer"] = _settings.Issuer,
            ["JwtSettings:Audience"] = _settings.Audience
        });
        builder.Services.AddSmartOpsAuth(builder.Configuration);
        builder.Services.AddPresentation();
        await using var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapGet("/fallback", () => Results.Ok());
        app.MapGet("/public", () => Results.Ok()).AllowAnonymous();
        var controllerTypes = typeof(AuthController).Assembly.GetTypes()
            .Where(type => type.Namespace == typeof(AuthController).Namespace && type.IsClass && !type.IsAbstract)
            .Where(type => type.Name.EndsWith("Controller") && type.Name is not "AuthController" and not "NotificationsController" and not "InternalUsersController")
            .ToArray();
        foreach (var controller in controllerTypes)
        {
            var policies = controller.GetCustomAttributes<AuthorizeAttribute>().ToArray();
            policies.Should().Contain(policy => policy.Policy == "Admin", controller.Name);
            app.MapGet($"/admin/{controller.Name}", () => Results.Ok()).RequireAuthorization(policies);
        }
        await app.StartAsync();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            (await client.GetAsync("/public")).StatusCode.Should().Be(HttpStatusCode.OK);
            var cases = new[]
            {
                (Token: (string?)null, Fallback: HttpStatusCode.Unauthorized, Admin: HttpStatusCode.Unauthorized),
                (Token: "invalid", Fallback: HttpStatusCode.Unauthorized, Admin: HttpStatusCode.Unauthorized),
                (Token: _tokens.IssueRefreshToken("42"), Fallback: HttpStatusCode.Unauthorized, Admin: HttpStatusCode.Unauthorized),
                (Token: _tokens.Issue("42", "audit@example.invalid", "viewer", "Audit"), Fallback: HttpStatusCode.OK, Admin: HttpStatusCode.Forbidden),
                (Token: _tokens.Issue("42", "audit@example.invalid", "admin", "Audit"), Fallback: HttpStatusCode.OK, Admin: HttpStatusCode.OK)
            };
            foreach (var testCase in cases)
            {
                client.DefaultRequestHeaders.Authorization = testCase.Token is null ? null : new AuthenticationHeaderValue("Bearer", testCase.Token);
                (await client.GetAsync("/fallback")).StatusCode.Should().Be(testCase.Fallback);
                foreach (var controller in controllerTypes)
                    (await client.GetAsync($"/admin/{controller.Name}")).StatusCode.Should().Be(testCase.Admin, controller.Name);
            }
        }
        finally
        {
            await app.StopAsync();
        }
    }

    [Fact]
    public void PasswordVerification_AcceptsCorrectPasswordAndRejectsWrongPassword()
    {
        var hash = PasswordHelper.Hash("audit-test-password");
        PasswordHelper.Verify("audit-test-password", hash).Should().BeTrue();
        PasswordHelper.Verify("wrong-audit-password", hash).Should().BeFalse();
    }

    [Fact]
    public void LocalCryptoTiming_ReportsCostsWithoutDatabaseOrNetwork()
    {
        var hash = PasswordHelper.Hash("audit-test-password");
        var refresh = _tokens.IssueRefreshToken("42");
        PasswordHelper.Verify("audit-test-password", hash).Should().BeTrue();
        _tokens.ValidateRefreshToken(refresh).Should().Be("42");
        var hashTimes = new List<double>();
        var refreshTimes = new List<double>();
        for (var iteration = 0; iteration < 20; iteration++)
        {
            var timer = Stopwatch.StartNew();
            PasswordHelper.Verify("audit-test-password", hash).Should().BeTrue();
            hashTimes.Add(timer.Elapsed.TotalMilliseconds);
            timer.Restart();
            _tokens.ValidateRefreshToken(refresh).Should().Be("42");
            _tokens.Issue("42", "audit@example.invalid", "viewer", "Audit", 7);
            _tokens.IssueRefreshToken("42");
            refreshTimes.Add(timer.Elapsed.TotalMilliseconds);
        }
        hashTimes.Sort();
        refreshTimes.Sort();
        _output.WriteLine($"Local crypto only, n=20: password verify median={hashTimes[9]:F2}ms p95={hashTimes[18]:F2}ms; " +
            $"refresh validation + token pair median={refreshTimes[9]:F2}ms p95={refreshTimes[18]:F2}ms. " +
            "Not an end-to-end login benchmark; no latency threshold asserted.");
    }
}