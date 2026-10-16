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

public sealed class CanonicalFieldsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly CanonicalFieldsController _sut;

    private static readonly CanonicalFieldDto Sample = new(1, 1, "WellName", "string", true, false, null, null, true);
    private static readonly CanonicalFieldCreateRequest CreateReq = new(1, "WellName", "string", true);
    private static readonly CanonicalFieldUpdateRequest UpdateReq = new(1, "WellName", "string", false);

    public CanonicalFieldsControllerTests() => _sut = new CanonicalFieldsController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<CanonicalFieldDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListCanonicalFieldsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<CanonicalFieldDto>>.Success(new PagedResult<CanonicalFieldDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListCanonicalFieldsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<CanonicalFieldDto>>.Success(new PagedResult<CanonicalFieldDto>(new List<CanonicalFieldDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetCanonicalFieldQuery(1), default)).ReturnsAsync(Result<CanonicalFieldDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetCanonicalFieldQuery(999), default)).ReturnsAsync(Result<CanonicalFieldDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateCanonicalFieldCommand(CreateReq), default)).ReturnsAsync(Result<CanonicalFieldDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateCanonicalFieldCommand(1, UpdateReq), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateCanonicalFieldCommand(999, UpdateReq), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteCanonicalFieldCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteCanonicalFieldCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
