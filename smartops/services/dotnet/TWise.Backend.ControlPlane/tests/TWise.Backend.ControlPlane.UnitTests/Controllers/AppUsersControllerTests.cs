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

public sealed class AppUsersControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly AppUsersController _sut;

    private static readonly AppUserDto SampleUser = new(1, "alice@example.com", null, "Alice", false, "active", true);
    private static readonly AppUserCreateRequest CreateReq = new("alice@example.com", "Alice", false, "active");
    private static readonly AppUserUpdateRequest UpdateReq = new("alice@example.com", "Alice Updated", "active");

    public AppUsersControllerTests() => _sut = new AppUsersController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<AppUserDto> { SampleUser };
        _sender.Setup(s => s.Send(It.IsAny<ListUsersQuery>(), default))
               .ReturnsAsync(Result<PagedResult<AppUserDto>>.Success(new PagedResult<AppUserDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListUsersQuery>(), default))
               .ReturnsAsync(Result<PagedResult<AppUserDto>>.Success(new PagedResult<AppUserDto>(new List<AppUserDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetUserQuery(1), default)).ReturnsAsync(Result<AppUserDto>.Success(SampleUser));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(SampleUser);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetUserQuery(999), default)).ReturnsAsync(Result<AppUserDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateUserCommand(CreateReq), default)).ReturnsAsync(Result<AppUserDto>.Success(SampleUser));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(SampleUser);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateUserCommand(1, UpdateReq), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateUserCommand(999, UpdateReq), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteUserCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteUserCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
