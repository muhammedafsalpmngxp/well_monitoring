using FluentAssertions;
using Moq;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Auth;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Features.Auth;

public sealed class AuthHandlerTests
{
    private readonly Mock<IAuthService> _auth = new();

    private static readonly LoginResponse SampleLogin =
        new("access-token", "refresh-token", 1, "user@twise.io", "User One", "viewer", 1);

    // ── LoginHandler ────────────────────────────────────────────────────────

    [Fact]
    public async Task Login_ReturnsSuccess_WhenServiceAuthenticates()
    {
        var request = new LoginRequest("user@twise.io", "correct-password");
        _auth.Setup(a => a.LoginAsync(request, It.IsAny<CancellationToken>())).ReturnsAsync(Result<LoginResponse>.Success(SampleLogin));
        var sut = new LoginHandler(_auth.Object);

        var result = await sut.Handle(new LoginCommand(request), default);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(SampleLogin);
    }

    [Fact]
    public async Task Login_ReturnsUnauthorized_WhenServiceRejects()
    {
        var request = new LoginRequest("user@twise.io", "wrong-password");
        _auth.Setup(a => a.LoginAsync(request, It.IsAny<CancellationToken>())).ReturnsAsync(Result<LoginResponse>.Unauthorized("Invalid email or password."));
        var sut = new LoginHandler(_auth.Object);

        var result = await sut.Handle(new LoginCommand(request), default);

        result.IsSuccess.Should().BeFalse();
        result.IsUnauthorized.Should().BeTrue();
        result.ErrorMessage.Should().Be("Invalid email or password.");
    }

    [Fact]
    public async Task Login_ReturnsUnauthorized_WhenAccountIsLocked()
    {
        var request = new LoginRequest("user@twise.io", "any-password");
        _auth.Setup(a => a.LoginAsync(request, It.IsAny<CancellationToken>())).ThrowsAsync(new AccountLockedException(12));
        var sut = new LoginHandler(_auth.Object);

        var result = await sut.Handle(new LoginCommand(request), default);

        result.IsUnauthorized.Should().BeTrue();
        result.ErrorMessage.Should().Be("Too many failed attempts. Try again in 12 minutes.");
    }

    // ── RefreshHandler ──────────────────────────────────────────────────────

    [Fact]
    public async Task Refresh_ReturnsSuccess_WhenServiceIssuesNewTokens()
    {
        _auth.Setup(a => a.RefreshAsync("valid-refresh-token", It.IsAny<CancellationToken>())).ReturnsAsync(SampleLogin);
        var sut = new RefreshHandler(_auth.Object);

        var result = await sut.Handle(new RefreshCommand("valid-refresh-token"), default);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(SampleLogin);
    }

    [Fact]
    public async Task Refresh_ReturnsUnauthorized_WhenServiceReturnsNull()
    {
        _auth.Setup(a => a.RefreshAsync("expired", It.IsAny<CancellationToken>())).ReturnsAsync((LoginResponse?)null);
        var sut = new RefreshHandler(_auth.Object);

        var result = await sut.Handle(new RefreshCommand("expired"), default);

        result.IsSuccess.Should().BeFalse();
        result.IsUnauthorized.Should().BeTrue();
        result.ErrorMessage.Should().Be("Invalid or expired refresh token.");
    }
}
