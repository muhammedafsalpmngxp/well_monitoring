using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi.Models;
using Moq;
using SmartOps.Shared.Auth;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.API.Extensions;
using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Features.Auth;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;
using TWise.Backend.ControlPlane.Infrastructure.Services;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Features.Auth;

public sealed class AuthSessionTests : IDisposable
{
    private readonly JwtSettings _settings = new()
    {
        SecretKey = "session-tests-only-signing-key-not-for-running-services-20261006",
        Issuer = "session-tests",
        Audience = "session-tests-api"
    };
    private readonly ControlPlaneDbContext _db;
    private readonly IJwtTokenService _tokens;
    private readonly AuthService _auth;
    private readonly AccessTokenValidator _validator;
    private readonly AppUser _user;

    public AuthSessionTests()
    {
        _db = new ControlPlaneDbContext(new DbContextOptionsBuilder<ControlPlaneDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        _tokens = new JwtTokenService(Options.Create(_settings));
        var access = new Mock<IAccessService>();
        access.Setup(service => service.GetEffectivePermissionsAsync(It.IsAny<int>(), It.IsAny<long>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<EffectivePermission>());
        _auth = new AuthService(_db, _tokens, access.Object, new LoginProtectionService(new MemoryCache(new MemoryCacheOptions())),
            Mock.Of<IGenericRepository<AuditEvent>>(), Mock.Of<IHttpContextAccessor>());
        _validator = new AccessTokenValidator(_db, _tokens);
        _user = new AppUser
        {
            UserId = 42,
            Email = "session@example.invalid",
            PasswordHash = PasswordHelper.Hash("test-password"),
            IsActive = true
        };
        _db.Users.Add(_user);
        _db.SaveChanges();
    }

    public void Dispose() => _db.Dispose();

    private async Task<LoginResponse> LoginAsync()
    {
        var result = await _auth.LoginAsync(new LoginRequest(_user.Email, "test-password"));
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    [Fact]
    public async Task Login_RejectsWrongPassword_AndAnInactiveAccount_WithTheirMessages()
    {
        var wrong = await _auth.LoginAsync(new LoginRequest(_user.Email, "wrong-password"));
        wrong.IsUnauthorized.Should().BeTrue();
        wrong.ErrorMessage.Should().Be("Invalid email or password.");

        _user.IsActive = false;
        _db.SaveChanges();
        var inactive = await _auth.LoginAsync(new LoginRequest(_user.Email, "test-password"));
        inactive.IsUnauthorized.Should().BeTrue();
        inactive.ErrorMessage.Should().Be("User is not active. Please contact Administration");
    }

    [Fact]
    public async Task Login_LocksTheAccount_AfterRepeatedFailures()
    {
        var locked = false;
        for (var i = 0; i < 20 && !locked; i++)
        {
            try { await _auth.LoginAsync(new LoginRequest(_user.Email, "wrong-password")); }
            catch (AccountLockedException) { locked = true; }
        }

        locked.Should().BeTrue();
        // Even the right password is refused while the lock lasts.
        await FluentActions.Invoking(() => _auth.LoginAsync(new LoginRequest(_user.Email, "test-password")))
            .Should().ThrowAsync<AccountLockedException>();
    }

    private static ClaimsPrincipal Principal(string token) => new(new ClaimsIdentity(
        new JwtSecurityTokenHandler().ReadJwtToken(token).Claims, "test"));

    private static string SessionId(string token) => Principal(token).FindFirst("sid")!.Value;

    [Fact]
    public async Task Login_CreatesIndependentSessionsAndRefreshPreservesIdentity()
    {
        var first = await LoginAsync();
        var second = await LoginAsync();
        var renewed = await _auth.RefreshAsync(first.RefreshToken);

        renewed.Should().NotBeNull();
        SessionId(first.Token).Should().Be(SessionId(first.RefreshToken));
        SessionId(first.Token).Should().NotBe(SessionId(second.Token));
        SessionId(renewed!.Token).Should().Be(SessionId(first.Token));
        SessionId(renewed.RefreshToken).Should().Be(SessionId(first.Token));
        (await _db.UserSessions.CountAsync()).Should().Be(2);
        (await _validator.ValidateAsync(Principal(first.Token), default)).Should().BeTrue();
    }

    [Fact]
    public async Task Logout_RevokesOriginalAndRenewedTokensButNotAnotherSession()
    {
        var first = await LoginAsync();
        var second = await LoginAsync();
        var renewed = (await _auth.RefreshAsync(first.RefreshToken))!;

        (await _auth.LogoutAsync(first.RefreshToken)).Should().BeTrue();
        _db.ChangeTracker.Clear();

        (await _validator.ValidateAsync(Principal(first.Token), default)).Should().BeFalse();
        (await _validator.ValidateAsync(Principal(renewed.Token), default)).Should().BeFalse();
        (await _auth.RefreshAsync(first.RefreshToken)).Should().BeNull();
        (await _auth.RefreshAsync(renewed.RefreshToken)).Should().BeNull();
        (await _validator.ValidateAsync(Principal(second.Token), default)).Should().BeTrue();
        (await _auth.RefreshAsync(second.RefreshToken)).Should().NotBeNull();
    }

    [Fact]
    public async Task Logout_IsIdempotentAndPreservesRevocationTimestamp()
    {
        var login = await LoginAsync();
        (await _auth.LogoutAsync(login.RefreshToken)).Should().BeTrue();
        var revokedAt = (await _db.UserSessions.SingleAsync()).RevokedAt;

        (await _auth.LogoutAsync(login.RefreshToken)).Should().BeTrue();
        (await _db.UserSessions.SingleAsync()).RevokedAt.Should().Be(revokedAt).And.NotBeNull();
    }

    [Fact]
    public async Task Logout_RejectsInvalidCredentialsWithoutRevokingAnySession()
    {
        var login = await LoginAsync();
        var stamp = _tokens.CreateSecurityStamp(_user.UserId.ToString(), _user.PasswordHash!);
        var invalid = new[]
        {
            string.Empty, "not.a.jwt", login.Token,
            _tokens.IssueRefreshToken("42", stamp),
            _tokens.IssueRefreshToken("42", "wrong-stamp", SessionId(login.Token)),
            _tokens.IssueRefreshToken("43", stamp, SessionId(login.Token)),
            _tokens.IssueRefreshToken("42", stamp, Guid.NewGuid().ToString())
        };
        foreach (var token in invalid)
            (await _auth.LogoutAsync(token)).Should().BeFalse();

        (await _db.UserSessions.AnyAsync(session => session.RevokedAt != null)).Should().BeFalse();
        (await _validator.ValidateAsync(Principal(login.Token), default)).Should().BeTrue();
    }

    [Fact]
    public async Task LegacyTokensWithoutSessionId_RequireNewLogin()
    {
        var stamp = _tokens.CreateSecurityStamp("42", _user.PasswordHash!);
        var access = _tokens.Issue("42", _user.Email, "viewer", "Session", 0, [], null, stamp);
        var refresh = _tokens.IssueRefreshToken("42", stamp);

        (await _validator.ValidateAsync(Principal(access), default)).Should().BeFalse();
        (await _auth.RefreshAsync(refresh)).Should().BeNull();
        (await _auth.LogoutAsync(refresh)).Should().BeFalse();
    }

    [Fact]
    public async Task RevokedSession_RejectsTokensIssuedByConcurrentRefresh()
    {
        var login = await LoginAsync();
        await _auth.LogoutAsync(login.RefreshToken);
        var stamp = _tokens.CreateSecurityStamp("42", _user.PasswordHash!);
        var lateAccess = _tokens.Issue(new JwtAccessTokenRequest
        {
            Subject = "42",
            Email = _user.Email,
            Role = "viewer",
            FullName = "Session",
            SecurityStamp = stamp,
            SessionId = SessionId(login.Token)
        });
        var lateRefresh = _tokens.IssueRefreshToken("42", stamp, SessionId(login.Token));

        (await _validator.ValidateAsync(Principal(lateAccess), default)).Should().BeFalse();
        (await _auth.RefreshAsync(lateRefresh)).Should().BeNull();
    }

    [Theory]
    [InlineData("inactive")]
    [InlineData("password")]
    [InlineData("deleted")]
    public async Task ExistingAccountRevocationRules_StillApply(string change)
    {
        var login = await LoginAsync();
        if (change == "inactive") _user.IsActive = false;
        if (change == "password") _user.PasswordHash = PasswordHelper.Hash("replacement-password");
        if (change == "deleted") _user.IsDeleted = true;
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        (await _validator.ValidateAsync(Principal(login.Token), default)).Should().BeFalse();
        (await _auth.RefreshAsync(login.RefreshToken)).Should().BeNull();
    }

    [Fact]
    public async Task HttpLogout_RevokesCurrentSessionAndExposesValidatedApiContract()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Development",
            ApplicationName = typeof(AuthController).Assembly.FullName
        });
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AzureAd:TenantId"] = "",
            ["JwtSettings:SecretKey"] = _settings.SecretKey,
            ["JwtSettings:Issuer"] = _settings.Issuer,
            ["JwtSettings:Audience"] = _settings.Audience
        });
        builder.Services.AddSmartOpsAuth(builder.Configuration);
        builder.Services.AddPresentation();
        builder.Services.AddSingleton<IAuthService>(_auth);
        builder.Services.AddSingleton<IAccessTokenValidator>(_validator);
        builder.Services.AddMediatR(options =>
        {
            options.TypeEvaluator = type => type.Namespace == typeof(LogoutHandler).Namespace;
            options.RegisterServicesFromAssemblyContaining<LogoutHandler>();
        });
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSwaggerGen(options => options.SwaggerDoc("v1", new OpenApiInfo { Title = "Logout tests", Version = "v1" }));
        await using var app = builder.Build();
        app.UseSwagger();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            (await client.GetAsync("/auth/session")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var loginResponse = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_user.Email, "test-password"));
            loginResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var first = (await loginResponse.Content.ReadFromJsonAsync<LoginResponse>())!;
            var secondResponse = await client.PostAsJsonAsync("/auth/login", new LoginRequest(_user.Email, "test-password"));
            var second = (await secondResponse.Content.ReadFromJsonAsync<LoginResponse>())!;
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", first.Token);
            (await client.GetAsync("/auth/session")).StatusCode.Should().Be(HttpStatusCode.NoContent);
            var refreshResponse = await client.PostAsJsonAsync("/auth/refresh-token", new RefreshRequest(first.RefreshToken));
            refreshResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var renewed = (await refreshResponse.Content.ReadFromJsonAsync<LoginResponse>())!;

            (await client.PostAsJsonAsync("/auth/logout", new { })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(" "))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(new string('x', 4097)))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await client.PostAsJsonAsync("/auth/logout", new LogoutRequest("invalid-token"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            (await client.GetAsync("/auth/session")).StatusCode.Should().Be(HttpStatusCode.NoContent);

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "expired-or-invalid-access-token");
            (await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(first.RefreshToken))).StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await client.PostAsJsonAsync("/auth/logout", new LogoutRequest(first.RefreshToken))).StatusCode.Should().Be(HttpStatusCode.NoContent);
            foreach (var token in new[] { first.Token, renewed.Token })
            {
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                (await client.GetAsync("/auth/session")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            }
            client.DefaultRequestHeaders.Authorization = null;
            foreach (var refresh in new[] { first.RefreshToken, renewed.RefreshToken })
                (await client.PostAsJsonAsync("/auth/refresh-token", new RefreshRequest(refresh))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", second.Token);
            (await client.GetAsync("/auth/session")).StatusCode.Should().Be(HttpStatusCode.NoContent);
            (await client.PostAsJsonAsync("/auth/refresh-token", new RefreshRequest(second.RefreshToken))).StatusCode.Should().Be(HttpStatusCode.OK);

            using var document = JsonDocument.Parse(await client.GetStringAsync("/swagger/v1/swagger.json"));
            var operation = document.RootElement.GetProperty("paths").GetProperty("/auth/logout").GetProperty("post");
            operation.GetProperty("responses").TryGetProperty("204", out _).Should().BeTrue();
            operation.GetProperty("responses").TryGetProperty("400", out _).Should().BeTrue();
            operation.GetProperty("responses").TryGetProperty("401", out _).Should().BeTrue();
        }
        finally
        {
            await app.StopAsync();
        }
    }
}