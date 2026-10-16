using System.Security.Claims;
using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class UserTenantRolesControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly UserTenantRolesController _sut;

    private static readonly UserTenantRoleDto Sample = new(1, 10, 20, 3, true);
    private static readonly UserTenantRoleCreateRequest CreateReq = new(10, 20, 3, true);
    private static readonly UserTenantRoleUpdateRequest UpdateReq = new(10, 20, 2, true);

    public UserTenantRolesControllerTests()
    {
        _sut = new UserTenantRolesController(_sender.Object);
        _sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("tenantId", "2") }))
            }
        };
    }

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var paged = new PagedResult<UserTenantRoleDto>(new List<UserTenantRoleDto> { Sample }, 1, 1, 200);
        _sender.Setup(s => s.Send(It.IsAny<ListUserTenantRolesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<UserTenantRoleDto>>.Success(paged));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        var paged = new PagedResult<UserTenantRoleDto>(new List<UserTenantRoleDto>(), 0, 1, 200);
        _sender.Setup(s => s.Send(It.IsAny<ListUserTenantRolesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<UserTenantRoleDto>>.Success(paged));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(It.IsAny<GetUserTenantRoleQuery>(), default)).ReturnsAsync(Result<UserTenantRoleDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(It.IsAny<GetUserTenantRoleQuery>(), default))
               .ReturnsAsync(Result<UserTenantRoleDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(It.IsAny<CreateUserTenantRoleCommand>(), default)).ReturnsAsync(Result<UserTenantRoleDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(It.IsAny<UpdateUserTenantRoleCommand>(), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(It.IsAny<UpdateUserTenantRoleCommand>(), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(It.IsAny<DeleteUserTenantRoleCommand>(), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(It.IsAny<DeleteUserTenantRoleCommand>(), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
