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

public sealed class CanonicalEntitiesControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly CanonicalEntitiesController _sut;

    private static readonly CanonicalEntityDto Sample = new(1, "Well", 1, "operational", "Oil well entity", true);
    private static readonly CanonicalEntityCreateRequest CreateReq = new("Well", 1, "operational", "Oil well entity");
    private static readonly CanonicalEntityUpdateRequest UpdateReq = new("Well", 1, "operational", "Updated description");

    public CanonicalEntitiesControllerTests() => _sut = new CanonicalEntitiesController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<CanonicalEntityDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListCanonicalEntitiesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<CanonicalEntityDto>>.Success(new PagedResult<CanonicalEntityDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListCanonicalEntitiesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<CanonicalEntityDto>>.Success(new PagedResult<CanonicalEntityDto>(new List<CanonicalEntityDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetCanonicalEntityQuery(1), default)).ReturnsAsync(Result<CanonicalEntityDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetCanonicalEntityQuery(999), default))
               .ReturnsAsync(Result<CanonicalEntityDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateCanonicalEntityCommand(CreateReq), default)).ReturnsAsync(Result<CanonicalEntityDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateCanonicalEntityCommand(1, UpdateReq), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateCanonicalEntityCommand(999, UpdateReq), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteCanonicalEntityCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteCanonicalEntityCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
