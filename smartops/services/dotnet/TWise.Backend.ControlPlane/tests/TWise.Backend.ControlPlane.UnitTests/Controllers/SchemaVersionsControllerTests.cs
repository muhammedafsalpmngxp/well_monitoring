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

public sealed class SchemaVersionsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly SchemaVersionsController _sut;

    public SchemaVersionsControllerTests() => _sut = new SchemaVersionsController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<SchemaVersionDto> { new(1, "v1.0", "Initial", null, true, true) };
        _sender.Setup(s => s.Send(It.IsAny<ListSchemaVersionsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<SchemaVersionDto>>.Success(new PagedResult<SchemaVersionDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListSchemaVersionsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<SchemaVersionDto>>.Success(new PagedResult<SchemaVersionDto>(new List<SchemaVersionDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        var dto = new SchemaVersionDto(1, "v1.0", null, null, true, true);
        _sender.Setup(s => s.Send(new GetSchemaVersionQuery(1), default)).ReturnsAsync(Result<SchemaVersionDto>.Success(dto));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(dto);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetSchemaVersionQuery(999), default))
               .ReturnsAsync(Result<SchemaVersionDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        var req = new SchemaVersionCreateRequest("v1.0", null, null, true);
        var dto = new SchemaVersionDto(1, "v1.0", null, null, true, true);
        _sender.Setup(s => s.Send(new CreateSchemaVersionCommand(req), default)).ReturnsAsync(Result<SchemaVersionDto>.Success(dto));

        var result = await _sut.Create(req, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(dto);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        var req = new SchemaVersionUpdateRequest("v1.1", null, null, true);
        _sender.Setup(s => s.Send(new UpdateSchemaVersionCommand(1, req), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, req, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        var req = new SchemaVersionUpdateRequest("v1.1", null, null, true);
        _sender.Setup(s => s.Send(new UpdateSchemaVersionCommand(999, req), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, req, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteSchemaVersionCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteSchemaVersionCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
