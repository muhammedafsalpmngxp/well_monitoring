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

public sealed class FieldMappingsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly FieldMappingsController _sut;

    private static readonly FieldMappingDto Sample = new(1, 10, 5, "WellTable", "WELL_NM", null, true);
    private static readonly FieldMappingCreateRequest CreateReq = new(10, 5, "WellTable", "WELL_NM", null);
    private static readonly FieldMappingUpdateRequest UpdateReq = new(10, 5, "WellTable", "WELL_NAME", "UPPER({src})");

    public FieldMappingsControllerTests() => _sut = new FieldMappingsController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<FieldMappingDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListFieldMappingsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<FieldMappingDto>>.Success(new PagedResult<FieldMappingDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListFieldMappingsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<FieldMappingDto>>.Success(new PagedResult<FieldMappingDto>(new List<FieldMappingDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetFieldMappingQuery(1), default)).ReturnsAsync(Result<FieldMappingDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetFieldMappingQuery(999), default)).ReturnsAsync(Result<FieldMappingDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateFieldMappingCommand(CreateReq), default)).ReturnsAsync(Result<FieldMappingDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateFieldMappingCommand(1, UpdateReq), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateFieldMappingCommand(999, UpdateReq), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteFieldMappingCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteFieldMappingCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
