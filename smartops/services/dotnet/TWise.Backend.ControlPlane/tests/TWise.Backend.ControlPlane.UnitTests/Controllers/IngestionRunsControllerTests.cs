using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Operations;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class IngestionRunsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly IngestionRunsController _sut;

    private static readonly IngestionRunDto Sample = new(1, 10, null, null, "completed", 500, 498, 2);
    private static readonly IngestionRunCreateRequest CreateReq = new(10, null, null, "pending", null, null, null);
    private static readonly IngestionRunUpdateRequest UpdateReq = new(10, null, null, "completed", 500, 498, 2);

    public IngestionRunsControllerTests() => _sut = new IngestionRunsController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<IngestionRunDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListIngestionRunsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<IngestionRunDto>>.Success(new PagedResult<IngestionRunDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListIngestionRunsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<IngestionRunDto>>.Success(new PagedResult<IngestionRunDto>(new List<IngestionRunDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetIngestionRunQuery(1), default)).ReturnsAsync(Result<IngestionRunDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetIngestionRunQuery(999), default)).ReturnsAsync(Result<IngestionRunDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateIngestionRunCommand(CreateReq), default)).ReturnsAsync(Result<IngestionRunDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateIngestionRunCommand(1, UpdateReq), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateIngestionRunCommand(999, UpdateReq), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteIngestionRunCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteIngestionRunCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
