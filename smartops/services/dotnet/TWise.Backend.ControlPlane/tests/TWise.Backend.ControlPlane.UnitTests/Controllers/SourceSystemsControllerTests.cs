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

public sealed class SourceSystemsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly SourceSystemsController _sut;

    private static readonly SourceSystemDto Sample = new(1, "SAP", "SAP ERP", "ERP", true);
    private static readonly SourceSystemCreateRequest CreateReq = new("SAP", "SAP ERP", "ERP");
    private static readonly SourceSystemUpdateRequest UpdateReq = new("SAP", "SAP ERP Updated", "ERP");

    public SourceSystemsControllerTests() => _sut = new SourceSystemsController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<SourceSystemDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListSourceSystemsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<SourceSystemDto>>.Success(new PagedResult<SourceSystemDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListSourceSystemsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<SourceSystemDto>>.Success(new PagedResult<SourceSystemDto>(new List<SourceSystemDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetSourceSystemQuery(1), default)).ReturnsAsync(Result<SourceSystemDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetSourceSystemQuery(999), default))
               .ReturnsAsync(Result<SourceSystemDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateSourceSystemCommand(CreateReq), default)).ReturnsAsync(Result<SourceSystemDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateSourceSystemCommand(1, UpdateReq), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateSourceSystemCommand(999, UpdateReq), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteSourceSystemCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteSourceSystemCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
