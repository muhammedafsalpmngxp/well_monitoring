using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class CapabilityProfilesControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly CapabilityProfilesController _sut;

    private static readonly CapabilityProfileDto Sample = new(1, 10, 5, true, null, true);
    private static readonly CapabilityProfileCreateRequest CreateReq = new(10, 5, true, null);
    private static readonly CapabilityProfileUpdateRequest UpdateReq = new(10, 5, false, "Not available in v2");

    public CapabilityProfilesControllerTests() => _sut = new CapabilityProfilesController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<CapabilityProfileDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListCapabilityProfilesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<CapabilityProfileDto>>.Success(new PagedResult<CapabilityProfileDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListCapabilityProfilesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<CapabilityProfileDto>>.Success(new PagedResult<CapabilityProfileDto>(new List<CapabilityProfileDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetCapabilityProfileQuery(1), default)).ReturnsAsync(Result<CapabilityProfileDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetCapabilityProfileQuery(999), default))
               .ReturnsAsync(Result<CapabilityProfileDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateCapabilityProfileCommand(CreateReq), default)).ReturnsAsync(Result<CapabilityProfileDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateCapabilityProfileCommand(1, UpdateReq), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateCapabilityProfileCommand(999, UpdateReq), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteCapabilityProfileCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteCapabilityProfileCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
