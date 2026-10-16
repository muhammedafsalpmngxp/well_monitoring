using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Auth;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class AuthControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly AuthController _sut;

    private static readonly LoginResponse SampleLogin =
        new("access-token", "refresh-token", 1, "user@twise.io", "User One", "viewer", 1);

    public AuthControllerTests() => _sut = new AuthController(_sender.Object);

    // ── Login ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Login_ReturnsOk_WithTokens_WhenCredentialsValid()
    {
        var request = new LoginRequest("user@twise.io", "correct-password");
        _sender.Setup(s => s.Send(It.Is<LoginCommand>(c => c.Request == request), default))
               .ReturnsAsync(Result<LoginResponse>.Success(SampleLogin));

        var result = await _sut.Login(request, default);

        result.Should().BeOfType<OkObjectResult>()
              .Which.Value.Should().Be(SampleLogin);
    }

    [Fact]
    public async Task Login_ReturnsUnauthorized_WhenCredentialsInvalid()
    {
        var request = new LoginRequest("user@twise.io", "wrong-password");
        _sender.Setup(s => s.Send(It.IsAny<LoginCommand>(), default))
               .ReturnsAsync(Result<LoginResponse>.Unauthorized("Invalid email or password."));

        var result = await _sut.Login(request, default);

        result.Should().BeOfType<UnauthorizedObjectResult>();
    }

    // ── Refresh ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Refresh_ReturnsOk_WithTokens_WhenRefreshTokenValid()
    {
        var request = new RefreshRequest("valid-refresh-token");
        _sender.Setup(s => s.Send(It.Is<RefreshCommand>(c => c.RefreshToken == request.RefreshToken), default))
               .ReturnsAsync(Result<LoginResponse>.Success(SampleLogin));

        var result = await _sut.Refresh(request, default);

        result.Should().BeOfType<OkObjectResult>()
              .Which.Value.Should().Be(SampleLogin);
    }

    [Fact]
    public async Task Refresh_ReturnsUnauthorized_WhenRefreshTokenInvalid()
    {
        var request = new RefreshRequest("expired-refresh-token");
        _sender.Setup(s => s.Send(It.IsAny<RefreshCommand>(), default))
               .ReturnsAsync(Result<LoginResponse>.Unauthorized("Invalid or expired refresh token."));

        var result = await _sut.Refresh(request, default);

        result.Should().BeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public async Task Logout_ReturnsNoContentAndForwardsCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        var request = new LogoutRequest("valid-refresh-token");
        _sender.Setup(sender => sender.Send(It.Is<LogoutCommand>(command => command.RefreshToken == request.RefreshToken), cancellation.Token))
            .ReturnsAsync(Result<bool>.Success(true));

        var result = await _sut.Logout(request, cancellation.Token);

        result.Should().BeOfType<NoContentResult>();
        _sender.Verify(sender => sender.Send(It.IsAny<LogoutCommand>(), cancellation.Token), Times.Once);
    }

    [Fact]
    public async Task Logout_ReturnsUnauthorizedForInvalidSession()
    {
        _sender.Setup(sender => sender.Send(It.IsAny<LogoutCommand>(), default))
            .ReturnsAsync(Result<bool>.Unauthorized("Invalid or expired session."));

        var result = await _sut.Logout(new LogoutRequest("invalid"), default);

        result.Should().BeOfType<UnauthorizedObjectResult>().Which.Value.Should().BeOfType<ProblemDetails>();
    }
}
