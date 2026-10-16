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

public sealed class RolesControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly RolesController _sut;

    private static readonly RoleDto SampleRole = new(1, "admin", "Administrator", "Administrator role", "global", null, true, true);
    private static readonly RoleCreateRequest CreateReq = new("admin", "Administrator", "Administrator role", "global");
    private static readonly RoleUpdateRequest UpdateReq = new("admin", "Administrator Updated", "Administrator role", "global");

    public RolesControllerTests()
    {
        _sut = new RolesController(_sender.Object);
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
        var paged = new PagedResult<RoleDto>(new List<RoleDto> { SampleRole }, 1, 1, 200);
        _sender.Setup(s => s.Send(It.IsAny<ListRolesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<RoleDto>>.Success(paged));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        var paged = new PagedResult<RoleDto>(new List<RoleDto>(), 0, 1, 200);
        _sender.Setup(s => s.Send(It.IsAny<ListRolesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<RoleDto>>.Success(paged));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(It.IsAny<GetRoleQuery>(), default)).ReturnsAsync(Result<RoleDto>.Success(SampleRole));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(SampleRole);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(It.IsAny<GetRoleQuery>(), default)).ReturnsAsync(Result<RoleDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(It.IsAny<CreateRoleCommand>(), default)).ReturnsAsync(Result<RoleDto>.Success(SampleRole));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(SampleRole);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(It.IsAny<UpdateRoleCommand>(), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(It.IsAny<UpdateRoleCommand>(), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(It.IsAny<DeleteRoleCommand>(), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(It.IsAny<DeleteRoleCommand>(), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
