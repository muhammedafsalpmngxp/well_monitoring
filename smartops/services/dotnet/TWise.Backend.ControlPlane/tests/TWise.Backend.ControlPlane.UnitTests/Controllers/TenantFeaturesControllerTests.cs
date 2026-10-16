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

public sealed class TenantFeaturesControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly TenantFeaturesController _sut;

    private static readonly TenantFeatureDto Sample = new(1, 10, 2, true, null, null, true);
    private static readonly TenantFeatureCreateRequest CreateReq = new(10, 2, true, null, null);
    private static readonly TenantFeatureUpdateRequest UpdateReq = new(10, 2, false, null, null);

    public TenantFeaturesControllerTests() => _sut = new TenantFeaturesController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<TenantFeatureDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListTenantFeaturesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<TenantFeatureDto>>.Success(new PagedResult<TenantFeatureDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListTenantFeaturesQuery>(), default))
               .ReturnsAsync(Result<PagedResult<TenantFeatureDto>>.Success(new PagedResult<TenantFeatureDto>(new List<TenantFeatureDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetTenantFeatureQuery(1), default)).ReturnsAsync(Result<TenantFeatureDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetTenantFeatureQuery(999), default))
               .ReturnsAsync(Result<TenantFeatureDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateTenantFeatureCommand(CreateReq), default)).ReturnsAsync(Result<TenantFeatureDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateTenantFeatureCommand(1, UpdateReq), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateTenantFeatureCommand(999, UpdateReq), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteTenantFeatureCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteTenantFeatureCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
