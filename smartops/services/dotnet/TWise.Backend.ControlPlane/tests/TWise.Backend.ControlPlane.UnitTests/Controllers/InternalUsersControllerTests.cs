using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class InternalUsersControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly InternalUsersController _sut;

    public InternalUsersControllerTests() => _sut = new InternalUsersController(_sender.Object);

    // ── Input validation ──────────────────────────────────────────────────────

    [Fact]
    public async Task CheckExists_ReturnsBadRequest_WhenUserIdIsZero()
    {
        var result = await _sut.CheckExists(userId: 0, tenantId: 5, default);

        var bad = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        bad.Value!.ToString().Should().Contain("userId");
    }

    [Fact]
    public async Task CheckExists_ReturnsBadRequest_WhenUserIdIsNegative()
    {
        var result = await _sut.CheckExists(userId: -1, tenantId: 5, default);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CheckExists_ReturnsBadRequest_WhenTenantIdIsZero()
    {
        var result = await _sut.CheckExists(userId: 1, tenantId: 0, default);

        var bad = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        bad.Value!.ToString().Should().Contain("tenantId");
    }

    [Fact]
    public async Task CheckExists_ReturnsBadRequest_WhenTenantIdIsNegative()
    {
        var result = await _sut.CheckExists(userId: 1, tenantId: -10, default);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task CheckExists_ReturnsBadRequest_WhenBothIdsInvalid()
    {
        var result = await _sut.CheckExists(userId: 0, tenantId: 0, default);

        // userId is checked first
        result.Should().BeOfType<BadRequestObjectResult>();
        _sender.Verify(s => s.Send(It.IsAny<CheckUserExistsQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Happy path ────────────────────────────────────────────────────────────

    [Fact]
    public async Task CheckExists_ReturnsOk_WithExistsTrue_WhenUserHasTenantAccess()
    {
        var response = new UserExistsResponse(true, 1, 5, "alice@example.com");
        _sender.Setup(s => s.Send(new CheckUserExistsQuery(1, 5), default)).ReturnsAsync(Result<UserExistsResponse>.Success(response));

        var result = await _sut.CheckExists(userId: 1, tenantId: 5, default);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        ok.Value.Should().BeEquivalentTo(response);
    }

    [Fact]
    public async Task CheckExists_ReturnsOk_WithExistsFalse_WhenUserNotFound()
    {
        var response = new UserExistsResponse(false, null, null, null);
        _sender.Setup(s => s.Send(new CheckUserExistsQuery(999, 5), default)).ReturnsAsync(Result<UserExistsResponse>.Success(response));

        var result = await _sut.CheckExists(userId: 999, tenantId: 5, default);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        ((UserExistsResponse)ok.Value!).Exists.Should().BeFalse();
    }

    [Fact]
    public async Task CheckExists_ReturnsOk_WithExistsFalse_WhenUserExistsButNoTenantAccess()
    {
        // User exists (UserId populated) but has no tenant role → Exists=false, TenantId=null
        var response = new UserExistsResponse(false, 1, null, null);
        _sender.Setup(s => s.Send(new CheckUserExistsQuery(1, 99), default)).ReturnsAsync(Result<UserExistsResponse>.Success(response));

        var result = await _sut.CheckExists(userId: 1, tenantId: 99, default);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = (UserExistsResponse)ok.Value!;
        body.Exists.Should().BeFalse();
        body.UserId.Should().Be(1);
        body.TenantId.Should().BeNull();
    }

    [Fact]
    public async Task CheckExists_DoesNotCallSender_WhenInputInvalid()
    {
        await _sut.CheckExists(userId: -5, tenantId: -5, default);

        _sender.Verify(s => s.Send(It.IsAny<CheckUserExistsQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Resolve ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Resolve_ReturnsBadRequest_WhenTenantIdIsMissing()
    {
        var result = await _sut.Resolve(new ResolveUsersRequest(0, [1], null), default);

        result.Should().BeOfType<BadRequestObjectResult>();
        _sender.Verify(s => s.Send(It.IsAny<ResolveUsersQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Resolve_ReturnsBadRequest_WhenTooManyLookups()
    {
        var ids = Enumerable.Range(1, 501).Select(i => (long)i).ToList();

        var result = await _sut.Resolve(new ResolveUsersRequest(2, ids, null), default);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Resolve_ReturnsEmptyList_WhenNothingIsAsked()
    {
        var result = await _sut.Resolve(new ResolveUsersRequest(2, null, []), default);

        ((List<DirectoryUserDto>)result.Should().BeOfType<OkObjectResult>().Subject.Value!).Should().BeEmpty();
        _sender.Verify(s => s.Send(It.IsAny<ResolveUsersQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Resolve_ReturnsOk_WithTheUsers()
    {
        var request = new ResolveUsersRequest(2, [1], ["planner"]);
        var users = new List<DirectoryUserDto> { new(1, "ana@t.om", "Ana", true, ["planner"], [101], ["reports.my-reports"]) };
        _sender.Setup(s => s.Send(new ResolveUsersQuery(request), default)).ReturnsAsync(Result<List<DirectoryUserDto>>.Success(users));

        var result = await _sut.Resolve(request, default);

        result.Should().BeOfType<OkObjectResult>().Subject.Value.Should().BeEquivalentTo(users);
    }
}
