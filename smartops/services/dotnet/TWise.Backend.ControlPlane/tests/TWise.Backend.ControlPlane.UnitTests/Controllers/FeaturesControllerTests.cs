using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class FeaturesControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly FeaturesController _sut;

    private static readonly FeatureDto SampleFeature = new(1, "DARK_MODE", "Dark mode toggle", true);
    private static readonly FeatureCreateRequest CreateReq = new("DARK_MODE", "Dark mode toggle");
    private static readonly FeatureUpdateRequest UpdateReq = new("DARK_MODE", "Dark mode updated");

    public FeaturesControllerTests() => _sut = new FeaturesController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var paged = new PagedResult<FeatureDto>(new List<FeatureDto> { SampleFeature }, 1, 1, 200);
        _sender.Setup(s => s.Send(It.IsAny<ListFeaturesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<FeatureDto>>.Success(paged));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        var paged = new PagedResult<FeatureDto>(new List<FeatureDto>(), 0, 1, 200);
        _sender.Setup(s => s.Send(It.IsAny<ListFeaturesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<FeatureDto>>.Success(paged));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetFeatureQuery(1), default)).ReturnsAsync(Result<FeatureDto>.Success(SampleFeature));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(SampleFeature);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetFeatureQuery(999), default)).ReturnsAsync(Result<FeatureDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateFeatureCommand(CreateReq), default)).ReturnsAsync(Result<FeatureDto>.Success(SampleFeature));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(SampleFeature);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateFeatureCommand(1, UpdateReq), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateFeatureCommand(999, UpdateReq), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteFeatureCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteFeatureCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
