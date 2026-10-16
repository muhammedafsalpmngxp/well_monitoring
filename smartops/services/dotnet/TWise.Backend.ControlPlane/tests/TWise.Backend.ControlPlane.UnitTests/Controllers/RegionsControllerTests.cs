using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Tenants;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class RegionsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly RegionsController _sut;

    public RegionsControllerTests() => _sut = new RegionsController(_sender.Object);

    // ── List ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<RegionDto> { new(1, "ME-EAST", "Middle East", true) };
        _sender.Setup(s => s.Send(It.IsAny<ListRegionsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<RegionDto>>.Success(new PagedResult<RegionDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListRegionsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<RegionDto>>.Success(new PagedResult<RegionDto>(new List<RegionDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    // ── Get ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        var dto = new RegionDto(1, "ME-EAST", "Middle East", true);
        _sender.Setup(s => s.Send(new GetRegionQuery(1), default)).ReturnsAsync(Result<RegionDto>.Success(dto));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(dto);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetRegionQuery(999), default)).ReturnsAsync(Result<RegionDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── Create ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        var req = new RegionCreateRequest("ME-EAST", "Middle East");
        var dto = new RegionDto(1, "ME-EAST", "Middle East", true);
        _sender.Setup(s => s.Send(new CreateRegionCommand(req), default)).ReturnsAsync(Result<RegionDto>.Success(dto));

        var result = await _sut.Create(req, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(dto);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        var req = new RegionUpdateRequest("ME-EAST", "Updated");
        _sender.Setup(s => s.Send(new UpdateRegionCommand(1, req), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, req, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        var req = new RegionUpdateRequest("ME-EAST", "Updated");
        _sender.Setup(s => s.Send(new UpdateRegionCommand(999, req), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, req, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteRegionCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteRegionCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
